'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PropertyProof, Receipt } from '@blackbox/receipts';
import './styles.css';

type Session = { sessionId: string; receipts: Receipt[]; chain: { valid: boolean; brokenAt: number | null; reason: string | null }; root: string; publicKey: string; walrus: { root?: string; blob?: unknown } | null; walrusConfigured: boolean; tampered?: number[] };
type ProofResult = { status: 'PASS' | 'FAIL'; step: number | null; reason: string | null; policyId: string; sessionRoot: string; steps?: number; root?: string; proof?: PropertyProof };

const short = (value: string | null | undefined, size = 8) => (value ? `${value.slice(0, size)}…${value.slice(-4)}` : 'GENESIS');
const clock = (timestamp: string) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export default function Home() {
  const [data, setData] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [tamperStep, setTamperStep] = useState(1);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [proofResult, setProofResult] = useState<ProofResult | null>(null);
  const lastBroken = useRef<number | null>(null);
  const refresh = useCallback(async () => { try { const response = await fetch('/api/session', { cache: 'no-store' }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? `Session request failed (${response.status})`); setData(result); } catch (error) { setData(null); setMessage(`Could not load the session: ${error instanceof Error ? error.message : String(error)}`); } }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, [refresh]);

  // When verification first detects a broken block, bring it on screen so the glitch is the first thing seen.
  const brokenAt = data?.chain.brokenAt ?? null;
  useEffect(() => {
    if (brokenAt !== null && lastBroken.current !== brokenAt) document.getElementById(`block-${brokenAt}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    lastBroken.current = brokenAt;
  }, [brokenAt]);

  async function proveNoSecrets() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/prove', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `Proof request failed (${response.status})`);
      setProofResult(result);
      await refresh();
    } catch (error) { setProofResult(null); setMessage(`Could not run the proof: ${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  }
  function downloadProof() {
    if (!proofResult?.proof) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(proofResult.proof, null, 2)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `proof-no-secrets-${proofResult.proof.sessionId.slice(0, 8)}.json` });
    link.click();
    URL.revokeObjectURL(url);
  }
  async function action(url: string, body?: unknown) { setBusy(true); setMessage(''); try { const response = await fetch(url, { method: 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Request failed'); setMessage(url.includes('restore') ? `Restored block(s) ${result.restoredSteps.join(', ')} to their signed originals.` : url.includes('tamper') ? `Block ${result.editedStep} edited on disk. Verification now rejects its signature.` : 'Upload completed. Walrus returned a blob response.'); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }

  const receipts = data?.receipts ?? [];
  const valid = data?.chain.valid ?? false;
  const stale = Boolean(proofResult && data && proofResult.sessionRoot !== data.root);
  const proof = proofResult?.status === 'PASS' && !stale;
  const failedStep = proofResult?.status === 'FAIL' ? proofResult.step : null;
  const proofSummary = !proofResult ? 'Not run yet' : stale ? 'Session changed since this proof ran; run it again' : proofResult.status === 'PASS' ? `${proofResult.steps} inclusion paths + commitments` : `${proofResult.step === null ? '' : `Step ${proofResult.step}: `}${proofResult.reason}`;
  const blob = data?.walrus?.blob as Record<string, unknown> | null | undefined;
  const blobId = blob && ('newlyCreated' in blob ? (blob.newlyCreated as Record<string, unknown>)?.blobObject : blob);
  const state = !receipts.length ? 'idle' : valid ? 'good' : 'bad';

  return <main className={`shell state-${state}`}>
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-mark" aria-hidden><i/></span>BLACKBOX<span className="brand-muted">/ RECEIPTS</span></a>
      <div className="top-right"><span className={`rec-dot ${state}`}/> {state === 'bad' ? 'TAMPER DETECTED' : 'RECORDING'}<span className="divider"/><span className="mono">{data?.sessionId.slice(0, 8) ?? 'loading'}</span></div>
    </header>

    <section className="hero">
      <div>
        <div className="eyebrow">FLIGHT RECORDER · AI AGENT TOOL CALLS</div>
        <h1>Every action is a <em>signed block.</em><br/>Edit one and the chain breaks.</h1>
      </div>
      <div className={`hero-status ${state}`} role="status" aria-live="polite">
        <div className="hero-status-label">CHAIN INTEGRITY</div>
        <div className="hero-status-value">{state === 'idle' ? 'No blocks yet' : state === 'good' ? 'Verified' : `Broken at block ${String(brokenAt).padStart(2, '0')}`}</div>
        <div className="hero-status-foot">{state === 'idle' ? 'Connect an MCP client to begin' : state === 'good' ? `${receipts.length} Ed25519 signatures valid` : data?.chain.reason}</div>
        <div className="hero-actions">
          <select className="block-picker" aria-label="Block to tamper" value={tamperStep} disabled={!receipts.length || busy} onChange={(event) => setTamperStep(Number(event.target.value))}>{receipts.map((receipt) => <option key={receipt.step} value={receipt.step}>Block {String(receipt.step).padStart(2, '0')}</option>)}</select>
          <button className="button button-danger" disabled={!receipts.length || busy} onClick={() => void action('/api/tamper', { step: tamperStep })}>Tamper a block <span aria-hidden>⌁</span></button>
          <button className="button button-ghost" disabled={!data?.tampered?.length || busy} onClick={() => void action('/api/restore')}>Restore <span aria-hidden>⟲</span></button>
          <button className="button button-ghost" disabled={!receipts.length || busy} onClick={() => void refresh()}>Re-verify <span aria-hidden>↻</span></button>
        </div>
      </div>
    </section>

    <section className="workspace">
      <div className="recorder">
        <div className="recorder-head">
          <div><div className="eyebrow">SESSION TRACE</div><h2>Recorder timeline</h2></div>
          <div className="meters"><span><b>{String(receipts.length).padStart(2, '0')}</b> BLOCKS</span><span><b>{state === 'bad' ? receipts.filter((r) => brokenAt !== null && r.step >= brokenAt).length : 0}</b> REJECTED</span></div>
        </div>

        {receipts.length ? <ol className="chain">{receipts.map((receipt) => {
          const broken = brokenAt === receipt.step || (!stale && failedStep === receipt.step);
          const downstream = brokenAt !== null && receipt.step > brokenAt;
          const open = expanded === receipt.step;
          return <li id={`block-${receipt.step}`} key={`${receipt.sessionId}-${receipt.step}`} className={`block ${broken ? 'block-broken' : downstream ? 'block-downstream' : 'block-ok'}`}>
            <div className="rail" aria-hidden><span className="node"/></div>
            <article className="block-card">
              <button className="block-main" aria-expanded={open} onClick={() => setExpanded(open ? null : receipt.step)}>
                <span className="block-index">#{String(receipt.step).padStart(2, '0')}</span>
                <span className="block-what"><strong className="glitch" data-text={receipt.tool}>{receipt.tool}</strong><small>{receipt.paths.join(', ') || receipt.permissions.join(', ') || 'no paths'}</small></span>
                <span className="block-time">{clock(receipt.timestamp)}</span>
              </button>
              <div className="block-seal">
                <span className="seal-hash"><label>PREV</label>{short(receipt.previousHash)}</span>
                <span className="seal-arrow" aria-hidden>→</span>
                <span className="seal-hash"><label>HASH</label>{short(receipt.hash)}</span>
                <span className="seal-sig">{broken ? (brokenAt === receipt.step ? '✕ SIG MISMATCH' : '✕ POLICY FAIL') : downstream ? '… UNTRUSTED' : '✓ SIGNED'}</span>
              </div>
              {open && <div className="details">
                <div><label>RECEIPT HASH</label><code>{receipt.hash}</code></div>
                <div><label>PREVIOUS</label><code>{receipt.previousHash ?? 'GENESIS'}</code></div>
                <div><label>ARGUMENTS · RESULT</label><code>{receipt.argsHash.slice(0, 20)}… · {receipt.resultHash.slice(0, 20)}…</code></div>
                <div><label>SIGNATURE</label><code>{receipt.signature.slice(0, 34)}…</code></div>
                {receipt.secretsAccessed && <div className="secret-warning">Policy blocked access to a secret path</div>}
              </div>}
            </article>
          </li>;
        })}</ol> : <div className="empty"><div className="empty-icon">⌁</div><strong>Recorder armed. Nothing recorded yet.</strong><span>Start the MCP proxy and call a tool. Signed blocks appear here as the agent works.</span><code>pnpm --filter @blackbox/proxy start</code></div>}

        <div className="recorder-foot"><span>MERKLE ROOT</span><code>{receipts.length ? data?.root ?? '—' : '—'}</code><button onClick={() => setExpanded(expanded === -1 ? null : -1)}>{expanded === -1 ? 'HIDE KEY' : 'PUBLIC KEY'}</button></div>
        {expanded === -1 && <div className="pubkey"><label>PROXY PUBLIC KEY</label><pre>{data?.publicKey}</pre></div>}
      </div>

      <aside className="side-panel">
        <div className="eyebrow">VERIFY SESSION</div>
        <h2>Make a claim. Check the math.</h2>
        <p className="side-copy">Blocks are signed by the proxy key, not the agent. Verify the linked chain, then prove properties against its Merkle root.</p>
        <div className={`proof-box ${proof ? 'proof-good' : proofResult?.status === 'FAIL' ? 'proof-bad' : ''}`}>
          <div className="proof-header"><span className="proof-symbol">◇</span><span>{proofResult?.policyId ?? 'no-secrets-read/v1'}</span></div>
          <h3>{!proofResult ? 'The agent never read secrets' : stale ? 'Proof is stale' : proof ? 'PASS: the agent never read secrets' : failedStep === null ? 'FAIL: property not proven' : `FAIL at block ${failedStep}`}</h3>
          <p title={proofSummary}>{!proofResult ? 'Checks every step against secret path globs (.env*, *.pem, ~/.ssh/**) and secret patterns in tool args. Reveals inclusion paths and commitments, never the args.' : stale ? 'The log changed after this proof ran. Run it again to cover the current chain.' : proof ? `All ${proofResult.steps} signed blocks satisfy the policy. Verified from the public key alone.` : proofResult.reason}</p>
          {proof && <div className="proof-path"><span>REVEALED PER STEP</span><code>leaf · signature · Merkle path · commitment</code><code>{proofResult?.steps} / {receipts.length} leaves · root {proofResult?.root?.slice(0, 18)}…</code><button className="link-button" onClick={downloadProof}>DOWNLOAD PROOF JSON ↓</button></div>}
        </div>
        <button className="button button-primary" disabled={busy} onClick={() => void proveNoSecrets()}>Prove: no secrets read <span aria-hidden>↗</span></button>
        <div className="anchor-box"><div><div className="eyebrow">WALRUS STORAGE</div><strong>{data?.walrus ? 'Session blob stored' : data?.walrusConfigured ? 'Pin the session log' : 'Publisher not configured'}</strong>{data?.walrus && <code>{typeof blobId === 'string' ? blobId : JSON.stringify(blobId)?.slice(0, 50)}</code>}</div><button className="anchor-button" aria-label={data?.walrus ? 'Re-upload session to Walrus' : 'Upload session to Walrus'} disabled={busy || !data?.walrusConfigured} title={data?.walrusConfigured ? undefined : 'Set WALRUS_PUBLISHER_URL to a funded publisher endpoint to enable uploads'} onClick={() => void action('/api/anchor')}>{data?.walrus ? '↻' : '↑'}</button></div>
        {message && <div className="notice" role="status">{message}</div>}
        <div className="disclaimer">Signatures prove what the proxy observed. They do not prove the proxy machine was uncompromised. TEE attestation is future work.</div>
      </aside>
    </section>

    <footer className="footer"><span>BLACKBOX RECEIPTS <span className="brand-muted">· OPEN AGENT / GITLAB DUO</span></span><span>ED25519 · SHA-256 · MERKLE</span></footer>
  </main>;
}
