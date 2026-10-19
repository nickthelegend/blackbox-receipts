'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PropertyProof, Receipt } from '@blackbox/receipts';
import './styles.css';

type Session = { sessionId: string; receipts: Receipt[]; chain: { valid: boolean; brokenAt: number | null; reason: string | null }; root: string; publicKey: string; walrus: { root?: string; blob?: unknown } | null; walrusConfigured: boolean };
type ProofResult = { status: 'PASS' | 'FAIL'; step: number | null; reason: string | null; policyId: string; sessionRoot: string; steps?: number; root?: string; proof?: PropertyProof };

export default function Home() {
  const [data, setData] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [proofResult, setProofResult] = useState<ProofResult | null>(null);
  const refresh = useCallback(async () => { try { const response = await fetch('/api/session', { cache: 'no-store' }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? `Session request failed (${response.status})`); setData(result); } catch (error) { setData(null); setMessage(`Could not load the session: ${error instanceof Error ? error.message : String(error)}`); } }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, [refresh]);
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
  async function action(url: string) { setBusy(true); setMessage(''); try { const response = await fetch(url, { method: 'POST' }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Request failed'); setMessage(url.includes('tamper') ? `Receipt ${result.editedStep} edited. Verification now detects the change.` : 'Upload completed. Walrus returned a blob response.'); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }

  const receipts = data?.receipts ?? [];
  const valid = data?.chain.valid ?? false;
  const stale = Boolean(proofResult && data && proofResult.sessionRoot !== data.root);
  const proof = proofResult?.status === 'PASS' && !stale;
  const failedStep = proofResult?.status === 'FAIL' ? proofResult.step : null;
  const proofSummary = !proofResult ? 'Not run yet' : stale ? 'Session changed since this proof ran; run it again' : proofResult.status === 'PASS' ? `${proofResult.steps} inclusion paths + commitments` : `${proofResult.step === null ? '' : `Step ${proofResult.step}: `}${proofResult.reason}`;
  const blob = data?.walrus?.blob as Record<string, unknown> | null | undefined;
  const blobId = blob && ('newlyCreated' in blob ? (blob.newlyCreated as Record<string, unknown>)?.blobObject : blob);
  return <main className="shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark">B</span> BLACKBOX <span className="brand-muted">/ RECEIPTS</span></a><div className="top-right"><span className="live-dot"/> LOCAL SESSION <span className="divider"/> <span className="mono">{data?.sessionId.slice(0, 8) ?? 'loading'}</span></div></header>
    <section className="hero"><div className="eyebrow"><span className="spark">✳</span> AGENT ACCOUNTABILITY LAYER</div><h1>Proof over promises.</h1><p>Every tool call, signed at the source. Every session, linked end to end. Ask what happened — and verify the answer.</p><div className="hero-meta"><span><b>{receipts.length.toString().padStart(2, '0')}</b> RECEIPTS</span><span className="divider"/><span>ED25519 SIGNED</span><span className="divider"/><span>SESSION {data?.sessionId.slice(0, 8).toUpperCase() ?? '—'}</span></div></section>
    <section className="status-grid">
      <article className={`status-card ${valid ? 'good' : receipts.length ? 'bad' : ''}`}><div className="card-kicker">CHAIN INTEGRITY <span className="status-icon">{receipts.length ? (valid ? '✓' : '!') : '·'}</span></div><div className="card-title">{receipts.length ? (valid ? 'Verified' : 'Chain broken') : 'Awaiting receipts'}</div><div className="card-foot">{receipts.length ? valid ? `${receipts.length} signatures valid` : `Step ${data?.chain.brokenAt}: ${data?.chain.reason}` : 'Connect an MCP client to begin'}</div></article>
      <article className={`status-card ${proof ? 'good' : proofResult?.status === 'FAIL' ? 'bad' : ''}`}><div className="card-kicker">POLICY PROOF <span className="status-icon">{proofResult ? (proof ? '✓' : '!') : '·'}</span></div><div className="card-title">{!proofResult ? 'No proof yet' : stale ? 'Proof is stale' : proof ? 'PASS: no secrets read' : failedStep === null ? 'FAIL' : `FAIL at step ${failedStep}`}</div><div className="card-foot" title={proofSummary}>{proofSummary}</div></article>
      <article className={`status-card ${data?.walrus ? 'good' : ''}`}><div className="card-kicker">WALRUS STORAGE <span className="status-icon">{data?.walrus ? '↗' : '·'}</span></div><div className="card-title">{data?.walrus ? 'Blob pinned' : 'Not anchored'}</div><div className="card-foot">{data?.walrus ? `Root ${data.walrus.root?.slice(0, 14)}…` : 'Configure a publisher endpoint'}</div></article>
    </section>
    <section className="workspace"><div className="timeline-panel"><div className="section-head"><div><div className="eyebrow">SESSION TRACE</div><h2>Receipt timeline</h2></div><div className={`integrity-pill ${receipts.length ? valid ? 'pill-good' : 'pill-bad' : ''}`}><span/> {receipts.length ? valid ? 'CHAIN VERIFIED' : `BROKEN AT ${data?.chain.brokenAt}` : 'NO ACTIVITY'}</div></div>
      {receipts.length ? <div className="timeline">{receipts.map((receipt, index) => <article className={`receipt ${data?.chain.brokenAt === receipt.step || (!stale && failedStep === receipt.step) ? 'receipt-broken' : ''}`} key={`${receipt.sessionId}-${receipt.step}`}><div className="step"><span>{String(receipt.step).padStart(2, '0')}</span><i/></div><div className="receipt-body"><button className="receipt-main" onClick={() => setExpanded(expanded === receipt.step ? null : receipt.step)}><span><strong>{receipt.tool}</strong><small>{receipt.paths.join(', ') || receipt.permissions.join(', ')}</small></span><span className="receipt-time">{new Date(receipt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}<b>{expanded === receipt.step ? '−' : '+'}</b></span></button>{expanded === receipt.step && <div className="details"><div><label>RECEIPT HASH</label><code>{receipt.hash}</code></div><div><label>PREVIOUS</label><code>{receipt.previousHash ?? 'GENESIS'}</code></div><div><label>ARGUMENTS · RESULT</label><code>{receipt.argsHash.slice(0, 20)}… · {receipt.resultHash.slice(0, 20)}…</code></div><div><label>SIGNATURE</label><code>{receipt.signature.slice(0, 34)}…</code></div>{receipt.secretsAccessed && <div className="secret-warning">Policy blocked access to a secret path</div>}</div>}</div></article>)}</div> : <div className="empty"><div className="empty-icon">⌁</div><strong>Nothing recorded yet</strong><span>Start the MCP proxy and call a tool. Signed receipts appear here as the agent works.</span><code>pnpm --filter @blackbox/proxy start</code></div>}
      <div className="timeline-footer"><span>MERKLE ROOT</span><code>{data?.root ?? '—'}</code><button onClick={() => setExpanded(expanded === -1 ? null : -1)}>ROOT DETAILS ↗</button></div>{expanded === -1 && <div className="pubkey"><label>PROXY PUBLIC KEY</label><pre>{data?.publicKey}</pre></div>}
    </div>
    <aside className="side-panel"><div className="eyebrow">VERIFY SESSION</div><h2>Make a claim.<br/>Check the math.</h2><p className="side-copy">Receipts carry signatures from the proxy key, not the agent. Verify the linked chain, then inspect proofs against its Merkle root.</p>
      <div className={`proof-box ${proof ? 'proof-good' : proofResult?.status === 'FAIL' ? 'proof-bad' : ''}`}><div className="proof-header"><span className="proof-symbol">◇</span><span>PROPERTY QUERY · {proofResult?.policyId ?? 'no-secrets-read/v1'}</span></div><h3>{!proofResult ? 'The agent never read secrets' : stale ? 'Proof is stale' : proof ? 'PASS: the agent never read secrets' : failedStep === null ? 'FAIL: property not proven' : `FAIL at step ${failedStep}`}</h3><p>{!proofResult ? 'Checks every step against secret path globs (.env*, *.pem, ~/.ssh/**) and secret patterns in tool args. The proof reveals inclusion paths and commitments, never the args.' : stale ? 'The receipt log changed after this proof ran. Run it again to cover the current chain.' : proof ? `All ${proofResult.steps} signed receipts satisfy the policy. Verified from the public key alone.` : proofResult.reason}</p>{proof && <div className="proof-path"><span>REVEALED PER STEP</span><code>leaf · signature · Merkle path · commitment</code><code>{proofResult?.steps} / {receipts.length} leaves · root {proofResult?.root?.slice(0, 18)}…</code><button className="proof-download" onClick={downloadProof}>DOWNLOAD PROOF JSON ↓</button></div>}</div>
      <button className="button button-primary" disabled={busy} onClick={() => void proveNoSecrets()}><span>◇</span> Prove: no secrets read <span className="button-arrow">↗</span></button>
      <button className="button button-secondary" disabled={!receipts.length || busy} onClick={() => void refresh()}><span>✓</span> Verify chain <span className="button-arrow">↗</span></button>
      <button className="button button-secondary" disabled={!receipts.length || busy} onClick={() => void action('/api/tamper')}><span>⌁</span> Run tamper demo <span className="button-arrow">↗</span></button>
      <div className="anchor-box"><div><div className="eyebrow">TAMPER EVIDENCE</div><strong>{valid ? 'All receipts intact' : receipts.length ? `Receipt ${data?.chain.brokenAt} altered` : 'Ready when you are'}</strong></div><span className={valid ? 'seal-good' : 'seal-bad'}>{valid ? '✓' : '!'}</span></div>
      <div className="anchor-box walrus-box"><div><div className="eyebrow">DECENTRALIZED STORAGE</div><strong>{data?.walrus ? 'Session blob stored' : 'Pin the session log'}</strong>{data?.walrus && <code>{typeof blobId === 'string' ? blobId : JSON.stringify(blobId)?.slice(0, 50)}</code>}</div><button className="anchor-button" aria-label={data?.walrus ? 'Re-upload session to Walrus' : 'Upload session to Walrus'} disabled={busy || !data?.walrusConfigured} title={data?.walrusConfigured ? undefined : 'Set WALRUS_PUBLISHER_URL to a funded publisher endpoint to enable uploads'} onClick={() => void action('/api/anchor')}>{data?.walrus ? '↻' : '↑'}</button></div>
      {message && <div className="notice" role="status">{message}</div>}
      <div className="disclaimer">Signatures prove what the proxy observed. They do not prove the proxy machine was uncompromised. TEE attestation is future work.</div>
    </aside></section>
    <footer className="footer"><span>BLACKBOX RECEIPTS <span className="brand-muted">· OPEN AGENT / GITLAB DUO</span></span><span>ED25519 · SHA-256 · MERKLE</span></footer>
  </main>;
}
