'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PropertyProof, Receipt } from '@blackbox/receipts';
import { Bento, Faq, HeroCopy, Logo, Mark, Nav } from './landing';
import './styles.css';

type Session = { sessionId: string; receipts: Receipt[]; chain: { valid: boolean; brokenAt: number | null; reason: string | null }; root: string; publicKey: string; walrus: { root?: string; blob?: unknown } | null; walrusConfigured: boolean; tampered?: number[] };
type ProofResult = { status: 'PASS' | 'FAIL'; step: number | null; reason: string | null; policyId: string; sessionRoot: string; steps?: number; root?: string; proof?: PropertyProof };
type Integration = { name: string; ok: boolean; detail: string };

const short = (value: string | null | undefined, size = 8) => (value ? `${value.slice(0, size)}…${value.slice(-4)}` : 'GENESIS');
const clock = (timestamp: string) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const pad = (n: number | null | undefined) => String(n ?? 0).padStart(2, '0');

// Env var names as the clients and README use them. Shown only when the live check reports missing config.
const SETUP_VARS: Record<string, string> = { Zetaris: 'ZETARIS_API_KEY, ZETARIS_ORG_ID', Meterless: 'METERLESS_TOKEN or METERLESS_STATE_DIR' };
const CHECKS: Record<string, string> = { Zetaris: 'Live check: list data marts', Meterless: 'Live check: GET /v1/models' };
function integrationView(item: Integration): { tone: 'ok' | 'warn' | 'bad'; pill: string; headline: string } {
  if (item.ok) return { tone: 'ok', pill: 'Live', headline: item.detail };
  if (/not configured|placeholder/i.test(item.detail)) {
    const missing = item.detail.match(/missing ([A-Z0-9_, ]+?)\./)?.[1];
    return { tone: 'warn', pill: 'Setup required', headline: `Setup required: ${missing ?? SETUP_VARS[item.name] ?? 'see README'}` };
  }
  return { tone: 'bad', pill: 'Check failed', headline: item.detail };
}

const SIG_LABEL = { ok: 'Signed', broken: 'Sig mismatch', policy: 'Policy fail', downstream: 'Untrusted' } as const;

export default function Home() {
  const [data, setData] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [integrations, setIntegrations] = useState<{ name: string; ok: boolean; detail: string }[] | null>(null);
  useEffect(() => { fetch('/api/integrations', { cache: 'no-store' }).then((r) => r.json()).then((d) => setIntegrations(d.integrations)).catch((e) => setIntegrations([{ name: 'Integrations', ok: false, detail: String(e) }])); }, []);
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

  // Same rules as before: a signature break wins, then a policy failure from a fresh proof, then downstream.
  const blockStatus = (step: number): keyof typeof SIG_LABEL => brokenAt === step ? 'broken' : !stale && failedStep === step ? 'policy' : brokenAt !== null && step > brokenAt ? 'downstream' : 'ok';
  const rejected = state === 'bad' ? receipts.filter((r) => brokenAt !== null && r.step >= brokenAt).length : 0;
  const loading = data === null && !message;
  const chainLabel = state === 'idle' ? 'No blocks yet' : state === 'good' ? 'Verified' : `Broken at block ${pad(brokenAt)}`;
  const chainFoot = state === 'idle' ? 'Connect an MCP client to begin' : state === 'good' ? `${receipts.length} Ed25519 signatures valid` : data?.chain.reason;
  const proofTone = proof ? 'ok' : proofResult?.status === 'FAIL' ? 'bad' : stale ? 'warn' : 'idle';

  return <div id="top" className="site">
    <a className="skip" href="#app">Skip to the recorder</a>

    <header className="hero hero-bleed">
      <Nav />
      <div className="hero-art" aria-hidden>
        <Mark className="hero-mark" />
        <div className="hero-scan" />
      </div>
      <div className="wrap">
        <HeroCopy />
        <aside className="widget rv" aria-label="Live session chain">
          <div className="w-top">
            <span className="w-title">Session chain</span>
            <span className={`tag tone-${loading ? 'idle' : data ? (state === 'good' ? 'ok' : state === 'bad' ? 'bad' : 'idle') : 'bad'}`}>{loading ? 'Loading' : data ? chainLabel : 'Unavailable'}</span>
          </div>
          <div className="w-sub"><span>Session</span><code>{data ? short(data.sessionId, 8) : '—'}</code></div>
          {loading ? <div className="w-empty">Loading the local session…</div>
            : !data ? <div className="w-empty w-error" role="alert">{message || 'The session API did not respond.'}</div>
            : !receipts.length ? <div className="w-empty"><b>Recorder armed.</b> Nothing recorded yet. Start the MCP proxy and call a tool.</div>
            : <ol className="w-chain">{receipts.slice(-3).map((receipt) => {
              const status = blockStatus(receipt.step);
              return <li key={receipt.step} className={`w-block w-${status}`}>
                <span className="w-step">#{pad(receipt.step)}</span>
                <span className="w-what"><b>{receipt.tool}</b><code>{short(receipt.hash, 10)}</code></span>
                <span className={`w-sig tone-${status === 'ok' ? 'ok' : status === 'downstream' ? 'idle' : 'bad'}`}>{SIG_LABEL[status]}</span>
              </li>;
            })}</ol>}
          <div className="w-note">{data && receipts.length ? <>Live from the local store · root <code>{short(data.root, 8)}</code></> : 'Reads .blackbox/session.jsonl every 3 s'}</div>
        </aside>
      </div>
      <div className="hazard" aria-hidden />
    </header>

    <main>
      <Bento />
      <Faq />

      <section id="app" className="app-page" aria-label="Recorder">
        <div className={`frame state-${state}`}>
          <header className="frame-top">
            <Logo href="#app" />
            <nav className="frame-nav" aria-label="Recorder sections">
              <a href="#timeline">Timeline</a><a href="#verify">Verify</a><a href="#integrations">Integrations</a><a href="#duo">Duo &amp; MCP</a>
            </nav>
            <div className="frame-status" role="status" aria-live="polite">
              <span className={`pill tone-${state === 'good' ? 'ok' : state === 'bad' ? 'bad' : 'idle'}`}><span className={`rec-dot ${state}`} aria-hidden />{state === 'bad' ? 'Tamper detected' : state === 'good' ? 'Recording' : 'Armed'}</span>
              <code className="frame-session" title={data?.sessionId}>{data?.sessionId.slice(0, 8) ?? 'loading'}</code>
            </div>
          </header>

          <div className="stats-row">
            <div className="stat-tile"><span>Blocks</span><b>{pad(receipts.length)}</b></div>
            <div className={`stat-tile ${rejected ? 'stat-bad' : ''}`}><span>Rejected</span><b>{pad(rejected)}</b></div>
            <div className={`stat-tile stat-wide tone-text-${state === 'good' ? 'ok' : state === 'bad' ? 'bad' : 'idle'}`}><span>Chain integrity</span><b>{loading ? 'Loading…' : chainLabel}</b><small title={chainFoot ?? undefined}>{loading ? 'Reading the local session' : chainFoot}</small></div>
          </div>

          <div className="frame-grid">
            <div className="col-main">
              <div id="timeline" className="panel">
                <div className="panel-head">
                  <div><span className="eyebrow">Session trace</span><h2>Recorder timeline</h2></div>
                  <span className="pill tone-idle">{receipts.length} {receipts.length === 1 ? 'block' : 'blocks'}</span>
                </div>

                {receipts.length ? <>
                  <div className="tbl-head" aria-hidden><span>Block</span><span>Tool · paths</span><span>Prev → hash</span><span>Signature</span><span>Time</span></div>
                  <ol className="chain">{receipts.map((receipt) => {
                    const status = blockStatus(receipt.step);
                    const broken = status === 'broken' || status === 'policy';
                    const open = expanded === receipt.step;
                    return <li id={`block-${receipt.step}`} key={`${receipt.sessionId}-${receipt.step}`} className={`block ${broken ? 'block-broken' : status === 'downstream' ? 'block-downstream' : 'block-ok'}`}>
                      <button className="block-main" aria-expanded={open} onClick={() => setExpanded(open ? null : receipt.step)}>
                        <span className="block-index">#{pad(receipt.step)}</span>
                        <span className="block-what"><strong className="glitch" data-text={receipt.tool}>{receipt.tool}</strong><small>{receipt.paths.join(', ') || receipt.permissions.join(', ') || 'no paths'}</small></span>
                        <span className="block-seal"><code>{short(receipt.previousHash)}</code><span aria-hidden>→</span><code>{short(receipt.hash)}</code></span>
                        <span className={`pill pill-sm tone-${status === 'ok' ? 'ok' : status === 'downstream' ? 'idle' : 'bad'}`}>{status === 'ok' ? '✓' : status === 'downstream' ? '…' : '✕'} {SIG_LABEL[status]}</span>
                        <span className="block-time">{clock(receipt.timestamp)}</span>
                      </button>
                      {open && <div className="details">
                        <div><label>Receipt hash</label><code>{receipt.hash}</code></div>
                        <div><label>Previous</label><code>{receipt.previousHash ?? 'GENESIS'}</code></div>
                        <div><label>Arguments · result</label><code>{receipt.argsHash.slice(0, 20)}… · {receipt.resultHash.slice(0, 20)}…</code></div>
                        <div><label>Signature</label><code>{receipt.signature.slice(0, 34)}…</code></div>
                        {receipt.secretsAccessed && <div className="secret-warning">Policy blocked access to a secret path</div>}
                      </div>}
                    </li>;
                  })}</ol>
                </> : <div className="empty">
                  <div className="empty-icon"><Mark /></div>
                  <strong>{loading ? 'Loading the session…' : data ? 'Recorder armed. Nothing recorded yet.' : 'Session unavailable'}</strong>
                  <span>{data || loading ? 'Start the MCP proxy and call a tool. Signed blocks appear here as the agent works.' : 'The dashboard could not read the local store. See the message in the Verify panel.'}</span>
                  <code>pnpm --filter @blackbox/proxy start</code>
                </div>}

                <div className="root-row"><span className="eyebrow">Merkle root</span><code title={receipts.length ? data?.root : undefined}>{receipts.length ? data?.root ?? '—' : '—'}</code><button className="pill-btn pill-btn-sm" aria-expanded={expanded === -1} onClick={() => setExpanded(expanded === -1 ? null : -1)}>{expanded === -1 ? 'Hide key' : 'Public key'}</button></div>
                {expanded === -1 && <div className="pubkey"><label>Proxy public key</label><pre>{data?.publicKey}</pre></div>}
              </div>
            </div>

            <aside className="col-side">
              <div className={`panel panel-integrity ${state}`}>
                <span className="eyebrow">Tamper test</span>
                <h2>Break a block, watch it fail.</h2>
                <p className="side-copy">Edits a stored receipt on disk with the same store function as the CLI. Restore puts the signed original back.</p>
                <div className="hero-actions">
                  <select className="block-picker" aria-label="Block to tamper" value={tamperStep} disabled={!receipts.length || busy} onChange={(event) => setTamperStep(Number(event.target.value))}>{receipts.map((receipt) => <option key={receipt.step} value={receipt.step}>Block {pad(receipt.step)}</option>)}</select>
                  <button className="pill-btn pill-btn-danger" disabled={!receipts.length || busy} onClick={() => void action('/api/tamper', { step: tamperStep })}>Tamper a block</button>
                  <button className="pill-btn" disabled={!data?.tampered?.length || busy} onClick={() => void action('/api/restore')}>Restore</button>
                  <button className="pill-btn" disabled={!receipts.length || busy} onClick={() => void refresh()}>Re-verify</button>
                </div>
              </div>

              <div id="verify" className="panel">
                <span className="eyebrow">Verify session</span>
                <h2>Make a claim. Check the math.</h2>
                <p className="side-copy">Blocks are signed by the proxy key, not the agent. Verify the linked chain, then prove properties against its Merkle root.</p>
                <div className={`proof-box proof-${proofTone}`}>
                  <div className="proof-header"><code>{proofResult?.policyId ?? 'no-secrets-read/v1'}</code><span className={`pill pill-sm tone-${proofTone}`}>{!proofResult ? 'Not run' : stale ? 'Stale' : proof ? 'PASS' : 'FAIL'}</span></div>
                  <h3>{!proofResult ? 'The agent never read secrets' : stale ? 'Proof is stale' : proof ? 'PASS: the agent never read secrets' : failedStep === null ? 'FAIL: property not proven' : `FAIL at block ${failedStep}`}</h3>
                  <p title={proofSummary}>{!proofResult ? 'Checks every step against secret path globs (.env*, *.pem, ~/.ssh/**) and secret patterns in tool args. Reveals inclusion paths and commitments, never the args.' : stale ? 'The log changed after this proof ran. Run it again to cover the current chain.' : proof ? `All ${proofResult.steps} signed blocks satisfy the policy. Verified from the public key alone.` : proofResult.reason}</p>
                  {proof && <div className="proof-path"><span>Revealed per step</span><code>leaf · signature · Merkle path · commitment</code><code>{proofResult?.steps} / {receipts.length} leaves · root {proofResult?.root?.slice(0, 18)}…</code><button className="link-button" onClick={downloadProof}>Download proof JSON ↓</button></div>}
                </div>
                <button className="pill-btn pill-btn-accent pill-btn-block" disabled={busy} onClick={() => void proveNoSecrets()}>Prove: no secrets read <span aria-hidden>↗</span></button>
                <div className="anchor-box"><div><span className="eyebrow">Walrus storage</span><strong>{data?.walrus ? 'Session blob stored' : data?.walrusConfigured ? 'Pin the session log' : 'Publisher not configured'}</strong>{data?.walrus ? <code>{typeof blobId === 'string' ? blobId : JSON.stringify(blobId)?.slice(0, 50)}</code> : data && !data.walrusConfigured && <small>Setup required: WALRUS_PUBLISHER_URL</small>}</div><button className="icon-btn" aria-label={data?.walrus ? 'Re-upload session to Walrus' : 'Upload session to Walrus'} disabled={busy || !data?.walrusConfigured} title={data?.walrusConfigured ? undefined : 'Set WALRUS_PUBLISHER_URL to a funded publisher endpoint to enable uploads'} onClick={() => void action('/api/anchor')}>{data?.walrus ? '↻' : '↑'}</button></div>
                {message && <div className="notice" role="status">{message}</div>}
              </div>

              <div id="integrations" className="panel" aria-label="Integrations">
                <div className="panel-head"><div><span className="eyebrow">Open Agent sponsors</span><h2>Integrations</h2></div></div>
                <div className="integrations">{integrations === null ? <div className="integration integration-loading"><span className="pill pill-sm tone-idle">Checking</span><span>Running live checks…</span></div> : integrations.map((item) => {
                  const view = integrationView(item);
                  return <div key={item.name} className={`integration integration-${view.tone}`} role={item.ok ? undefined : 'alert'}>
                    <div className="integration-top"><b>{item.name}</b><span className={`pill pill-sm tone-${view.tone}`}>{view.pill}</span></div>
                    <strong className="integration-head">{view.headline}</strong>
                    {!item.ok && view.headline !== item.detail && <span className="integration-detail">{item.detail}</span>}
                    {CHECKS[item.name] && <span className="integration-check">{CHECKS[item.name]}</span>}
                  </div>;
                })}</div>
                <p className="disclaimer">Neither client is used in the agent loop yet. Results here come from a live request; nothing is cached or simulated.</p>
              </div>
            </aside>
          </div>

          <div id="duo" className="duo-grid">
            <div className="panel">
              <div className="panel-head"><div><span className="eyebrow">MCP proxy</span><h2>Any MCP client</h2></div><span className={`pill tone-${receipts.length ? 'ok' : 'idle'}`}>{receipts.length ? `${receipts.length} recorded` : 'Waiting'}</span></div>
              <dl className="kv">
                <div><dt>Start</dt><dd><code>pnpm --filter @blackbox/proxy start</code></dd></div>
                <div><dt>Transport</dt><dd><code>stdio · packages/proxy/dist/server.js</code></dd></div>
                <div><dt>Tools</dt><dd className="chips-sm"><span>read_file</span><span>git</span><span>shell</span></dd></div>
                <div><dt>Store</dt><dd><code>.blackbox/session.jsonl</code></dd></div>
              </dl>
            </div>
            <div className="panel">
              <div className="panel-head"><div><span className="eyebrow">GitLab Duo</span><h2>Custom flow</h2></div><span className="pill tone-warn">Not yet run on GitLab</span></div>
              <dl className="kv">
                <div><dt>Flow</dt><dd><code>.gitlab/duo/flows/blackbox-receipts.yaml</code></dd></div>
                <div><dt>Bridge</dt><dd><code>node packages/proxy/dist/call.js &lt;tool&gt; &apos;&lt;json&gt;&apos;</code></dd></div>
                <div><dt>CI</dt><dd><code>.gitlab-ci.yml</code></dd></div>
                <div><dt>IDE</dt><dd><code>.gitlab/duo/mcp.json</code></dd></div>
              </dl>
              <p className="disclaimer">Setup: docs/gitlab-setup.md. No Duo run or pipeline history exists yet.</p>
            </div>
          </div>

          <footer className="frame-foot">
            <p>Signatures prove what the proxy observed. They do not prove the proxy machine was uncompromised. TEE attestation is future work.</p>
            <div><span>Blackbox Receipts · Open Agent / GitLab Duo</span><span>Ed25519 · SHA-256 · Merkle · MIT</span></div>
          </footer>
        </div>
      </section>
    </main>
  </div>;
}
