'use client';

// The live recorder: an instrument panel over the local receipt store. An annunciator row reports the
// chain, secret access, the no-secrets proof, tamper state, Walrus and the two sponsor clients; the tape
// plots the signed receipts as they arrive. Every lamp comes from a live API response; a missing key is
// shown as "Setup required", never as a pass.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PropertyProof, Receipt } from '@blackbox/receipts';
import { defaultSecretPolicy } from '@blackbox/verify';
import { Logo, Mark } from '../components/brand';
import { Tape, type TapeStep, type TapeTone } from '../components/strip';
import { ExplainDrawer } from '../components/explain-drawer';
import type { Explanation } from '@blackbox/proxy/explain';
import './recorder.css';

type Session = { sessionId: string; receipts: Receipt[]; chain: { valid: boolean; brokenAt: number | null; reason: string | null }; root: string; publicKey: string; walrus: { root?: string; blob?: unknown } | null; walrusConfigured: boolean; tampered?: number[]; source: string };
type ProofResult = { status: 'PASS' | 'FAIL'; step: number | null; reason: string | null; policyId: string; sessionRoot: string; chainBrokenAt: number | null; steps?: number; root?: string; proof?: PropertyProof };
type Integration = { name: string; ok: boolean; detail: string };
type Tone = 'ok' | 'bad' | 'caution' | 'idle';
type Lamp = { id: string; label: string; state: string; tone: Tone; detail: string };

const pad = (n: number | null | undefined) => String(n ?? 0).padStart(2, '0');
const short = (value: string | null | undefined, size = 8) => (value ? `${value.slice(0, size)}…${value.slice(-4)}` : 'GENESIS');
const clock = (timestamp: string) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function duration(receipts: Receipt[]): string {
  if (receipts.length < 2) return '—';
  const ms = Date.parse(receipts[receipts.length - 1].timestamp) - Date.parse(receipts[0].timestamp);
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${pad(s % 60)}s` : `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

// Env var names as the clients and README use them. Shown only when the live check reports missing config.
const SETUP_VARS: Record<string, string> = { Zetaris: 'ZETARIS_API_KEY, ZETARIS_ORG_ID', Meterless: 'METERLESS_TOKEN or METERLESS_STATE_DIR' };
const CHECKS: Record<string, string> = { Zetaris: 'Live check: list data marts', Meterless: 'Live check: GET /v1/models' };
function integrationLamp(item: Integration): Lamp {
  const id = item.name.toLowerCase();
  if (item.ok) return { id, label: item.name, state: 'Live', tone: 'ok', detail: item.detail };
  if (/not configured|placeholder/i.test(item.detail)) {
    const missing = item.detail.match(/missing ([A-Z0-9_, ]+?)\./)?.[1];
    return { id, label: item.name, state: 'Setup required', tone: 'caution', detail: `Set ${missing ?? SETUP_VARS[item.name] ?? 'the keys in README'}` };
  }
  return { id, label: item.name, state: 'Check failed', tone: 'bad', detail: item.detail };
}

export default function Recorder() {
  const [data, setData] = useState<Session | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [tamperStep, setTamperStep] = useState(1);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [proofResult, setProofResult] = useState<ProofResult | null>(null);
  const lastBroken = useRef<number | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explainError, setExplainError] = useState('');
  const [explainStep, setExplainStep] = useState<number | null>(null);
  const closeExplain = useCallback(() => setExplainStep(null), []);

  useEffect(() => {
    fetch('/api/integrations', { cache: 'no-store' })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? `Integrations request failed (${response.status})`); setIntegrations(body.integrations); })
      .catch((error) => setIntegrations([{ name: 'Zetaris', ok: false, detail: errorText(error) }, { name: 'Meterless', ok: false, detail: errorText(error) }]));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `Session request failed (${response.status})`);
      setData(result); setLoadError('');
    } catch (error) { setData(null); setLoadError(`Could not load the session: ${errorText(error)}`); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, [refresh]);

  // The explanation follows the log: fetched again whenever the root or the break changes.
  const explainKey = data ? `${data.root}:${data.chain.brokenAt ?? ''}:${data.receipts.length}` : '';
  useEffect(() => {
    if (!explainKey || explainKey.endsWith(':0')) { setExplanation(null); return; }
    let live = true;
    fetch('/api/explain', { cache: 'no-store' })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? `Explain request failed (${response.status})`); if (live) { setExplanation(body); setExplainError(''); } })
      .catch((error) => { if (live) { setExplanation(null); setExplainError(errorText(error)); } });
    return () => { live = false; };
  }, [explainKey]);
  const explainOf = (step: number, hash: string) => explanation?.steps.find((item) => item.step === step && item.receipt === hash) ?? null;

  // When verification first detects a broken block, bring its log row on screen.
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
    } catch (error) { setProofResult(null); setMessage(`Could not run the proof: ${errorText(error)}`); } finally { setBusy(false); }
  }
  function downloadProof() {
    if (!proofResult?.proof) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(proofResult.proof, null, 2)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `proof-no-secrets-${proofResult.proof.sessionId.slice(0, 8)}.json` });
    link.click();
    URL.revokeObjectURL(url);
  }
  async function action(url: string, body?: unknown) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(url, { method: 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Request failed');
      setMessage(url.includes('restore') ? `Restored block(s) ${result.restoredSteps.join(', ')} to their signed originals.` : url.includes('tamper') ? `Block ${result.editedStep} edited on disk. Verification now rejects its signature.` : 'Upload completed. Walrus returned a blob response.');
      await refresh();
    } catch (error) { setMessage(errorText(error)); } finally { setBusy(false); }
  }

  const receipts = data?.receipts ?? [];
  const loading = data === null && !loadError;
  const valid = data?.chain.valid ?? false;
  const state: 'idle' | 'good' | 'bad' = !receipts.length ? 'idle' : valid ? 'good' : 'bad';
  const stale = Boolean(proofResult && data && (proofResult.sessionRoot !== data.root || proofResult.chainBrokenAt !== data.chain.brokenAt));
  const proofPass = proofResult?.status === 'PASS' && !stale;
  const failedStep = proofResult?.status === 'FAIL' && !stale ? proofResult.step : null;
  const secretSteps = receipts.filter((receipt) => receipt.secretsAccessed).map((receipt) => receipt.step);
  const deniedCount = receipts.filter((receipt) => receipt.outcome === 'denied').length;
  const rejected = state === 'bad' ? receipts.filter((receipt) => brokenAt !== null && receipt.step >= brokenAt).length : 0;
  const blob = data?.walrus?.blob as Record<string, unknown> | null | undefined;
  const blobId = blob && ('newlyCreated' in blob ? (blob.newlyCreated as Record<string, unknown>)?.blobObject : blob);

  type Status = 'ok' | 'broken' | 'policy' | 'secret' | 'downstream';
  const blockStatus = (receipt: Receipt): Status => brokenAt === receipt.step ? 'broken' : brokenAt !== null && receipt.step > brokenAt ? 'downstream' : failedStep === receipt.step ? 'policy' : receipt.secretsAccessed ? 'secret' : 'ok';
  const STATUS_LABEL: Record<Status, string> = { ok: 'Signed', broken: 'Signature fails', policy: 'Policy fail', secret: 'Secret access', downstream: 'Untrusted' };
  const STATUS_TONE: Record<Status, Tone> = { ok: 'ok', broken: 'bad', policy: 'bad', secret: 'bad', downstream: 'idle' };

  const tapeSteps: TapeStep[] = receipts.map((receipt) => {
    const status = blockStatus(receipt);
    const tone: TapeTone = status === 'broken' ? 'broken' : status === 'downstream' ? 'untrusted' : status === 'secret' || status === 'policy' ? 'alarm' : receipt.outcome === 'error' ? 'error' : 'ok';
    const flag = status === 'broken' ? `Signature fails · ${pad(receipt.step)}` : status === 'secret' ? `${receipt.outcome === 'denied' ? 'Denied' : 'Secret'} · ${receipt.paths[0] || receipt.tool}` : status === 'policy' ? `Policy fail · ${pad(receipt.step)}` : undefined;
    return { step: receipt.step, at: Date.parse(receipt.timestamp), tool: receipt.tool, tone, flag };
  });

  const sessionLamps: Lamp[] = [
    loading ? { id: 'chain', label: 'Chain', state: 'Reading', tone: 'idle', detail: 'Loading the local store' }
      : !data ? { id: 'chain', label: 'Chain', state: 'No signal', tone: 'bad', detail: 'Session API did not respond' }
      : state === 'idle' ? { id: 'chain', label: 'Chain', state: 'No data', tone: 'idle', detail: 'Nothing recorded yet' }
      : state === 'good' ? { id: 'chain', label: 'Chain', state: 'Verified', tone: 'ok', detail: `${receipts.length} signatures and links` }
      : { id: 'chain', label: 'Chain', state: `Broken · ${pad(brokenAt)}`, tone: 'bad', detail: data.chain.reason ?? 'Verification failed' },
    !receipts.length ? { id: 'secret', label: 'Secret paths', state: 'No data', tone: 'idle', detail: `Policy ${defaultSecretPolicy.id}` }
      : secretSteps.length ? { id: 'secret', label: 'Secret paths', state: `Touched · ${secretSteps.map(pad).join(', ')}`, tone: 'bad', detail: deniedCount ? `${deniedCount} call(s) denied before running` : 'Signed as secret access' }
      : { id: 'secret', label: 'Secret paths', state: 'None', tone: 'ok', detail: 'No receipt is signed as secret access' },
    !proofResult ? { id: 'proof', label: 'No-secrets proof', state: 'Not run', tone: 'idle', detail: 'Run it from the controls' }
      : stale ? { id: 'proof', label: 'No-secrets proof', state: 'Stale', tone: 'caution', detail: 'Session changed since it ran' }
      : proofPass ? { id: 'proof', label: 'No-secrets proof', state: 'Pass', tone: 'ok', detail: `${proofResult.steps} inclusion paths verified` }
      : { id: 'proof', label: 'No-secrets proof', state: proofResult.step === null ? 'Fail' : `Fail · ${pad(proofResult.step)}`, tone: 'bad', detail: proofResult.reason ?? 'Property not proven' },
    data?.tampered?.length ? { id: 'tamper', label: 'Tamper test', state: `Edited · ${data.tampered.map(pad).join(', ')}`, tone: 'caution', detail: 'Restore puts the signed original back' }
      : { id: 'tamper', label: 'Tamper test', state: 'Off', tone: 'idle', detail: 'No block edited on disk' },
    !data ? { id: 'walrus', label: 'Walrus', state: loading ? 'Reading' : 'No signal', tone: 'idle', detail: 'Waiting for the session API' }
      : data.walrus ? { id: 'walrus', label: 'Walrus', state: 'Stored', tone: 'ok', detail: 'Session blob uploaded' }
      : data.walrusConfigured ? { id: 'walrus', label: 'Walrus', state: 'Ready', tone: 'idle', detail: 'Publisher configured, nothing stored' }
      : { id: 'walrus', label: 'Walrus', state: 'Setup required', tone: 'caution', detail: 'Set WALRUS_PUBLISHER_URL' },
  ];
  const sponsorLamps: Lamp[] = integrations === null
    ? ['Zetaris', 'Meterless'].map((name) => ({ id: name.toLowerCase(), label: name, state: 'Checking', tone: 'idle' as Tone, detail: CHECKS[name] }))
    : integrations.map(integrationLamp);
  const lamps = [...sessionLamps, ...sponsorLamps];
  const master: Tone = lamps.some((lamp) => lamp.tone === 'bad') ? 'bad' : 'ok';

  return <div className="rc">
    <a className="skip" href="#rc-main">Skip to the recorder</a>
    <header className="rc-top">
      <div className="rc-wrap rc-top-row">
        <Logo href="/" tag="Recorder" />
        <nav className="rc-nav" aria-label="Recorder">
          <a href="/">Overview</a>
          <a href="/verify">Verify a pack</a>
        </nav>
        <div className="rc-rec" role="status" aria-live="polite">
          <span className={`rc-rec-dot is-${state}`} aria-hidden />
          <span>{state === 'bad' ? 'Tamper detected' : state === 'good' ? 'Recording' : loading ? 'Loading' : data ? 'Armed' : 'No signal'}</span>
          <code title={data?.sessionId}>{data ? data.sessionId.slice(0, 8) : '········'}</code>
        </div>
      </div>
    </header>

    <main id="rc-main" className="rc-wrap">
      <section className="rc-annunciator" aria-labelledby="rc-ann-title">
        <div className="rc-ann-head">
          <h1 id="rc-ann-title" className="stencil">Annunciator panel</h1>
          <span className={`rc-master is-${master}`}>{master === 'bad' ? 'Master warning' : 'No warnings'}</span>
        </div>
        <ul className="rc-lamps">
          {lamps.map((lamp) => <li key={lamp.id} className={`rc-lamp is-${lamp.tone}`} role={lamp.tone === 'bad' ? 'alert' : undefined}>
            <span className="rc-lamp-face"><span className="rc-lamp-label">{lamp.label}</span><b>{lamp.state}</b></span>
            <small title={lamp.detail}>{lamp.detail}</small>
          </li>)}
        </ul>
        {loadError && <p className="rc-alert" role="alert">{loadError}</p>}
      </section>

      <section className="rc-readouts" aria-label="Readouts">
        <div><span className="stencil">Blocks</span><b>{pad(receipts.length)}</b></div>
        <div className={rejected ? 'is-bad' : undefined}><span className="stencil">Rejected</span><b>{pad(rejected)}</b></div>
        <div className={deniedCount ? 'is-bad' : undefined}><span className="stencil">Denied calls</span><b>{pad(deniedCount)}</b></div>
        <div><span className="stencil">Recorded span</span><b>{duration(receipts)}</b></div>
        <div className="rc-root">
          <span className="stencil">Merkle root</span>
          <code title={receipts.length ? data?.root : undefined}>{receipts.length && data ? data.root : '—'}</code>
          <button type="button" className="rc-link" aria-expanded={showKey} disabled={!data} onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide public key' : 'Show public key'}</button>
        </div>
        {showKey && data && <pre className="rc-key" aria-label="Proxy public key">{data.publicKey}</pre>}
      </section>

      <div className="rc-grid">
        <section id="tape" className="rc-panel" aria-labelledby="rc-tape-title">
          <div className="rc-panel-head">
            <div><span className="stencil">Live tape</span><h2 id="rc-tape-title">Session {data ? short(data.sessionId, 8) : '—'}</h2></div>
            <span className="rc-note">Reads {data?.source ?? 'the session store'} every 3 s</span>
          </div>

          {receipts.length > 0 && data ? <>
            <Tape steps={tapeSteps} label={`Strip chart of ${receipts.length} signed tool calls in session ${data.sessionId}. The tape log below lists every call.`} />
            <div className="rc-legend" aria-hidden>
              <span><i className="lg-ok" />Signed call</span><span><i className="lg-error" />Tool error</span><span><i className="lg-alarm" />Secret access or failure</span><span><i className="lg-untrusted" />Untrusted (after a break)</span><span><i className="lg-trace" />Hash link</span>
            </div>
            <h3 id="rc-log-title" className="stencil rc-log-title">Tape log</h3>
            <ol className="rc-log" aria-labelledby="rc-log-title">{receipts.map((receipt) => {
              const status = blockStatus(receipt);
              const open = expanded === receipt.step;
              return <li id={`block-${receipt.step}`} key={`${receipt.sessionId}-${receipt.step}`} className={`rc-row is-${STATUS_TONE[status]}${status === 'downstream' ? ' is-down' : ''}`}>
                <button type="button" className="rc-row-main" aria-expanded={open} onClick={() => setExpanded(open ? null : receipt.step)}>
                  <span className="rc-row-n">{pad(receipt.step)}</span>
                  <span className="rc-row-time">{clock(receipt.timestamp)}</span>
                  <span className="rc-row-what"><strong>{receipt.tool}</strong><code>{receipt.paths.filter(Boolean).join(' ') || receipt.permissions.join(', ') || 'no paths'}</code></span>
                  <span className="rc-row-out">{receipt.outcome ?? '—'}</span>
                  <span className="rc-row-seal"><code>{short(receipt.previousHash, 6)}</code><span aria-hidden> → </span><code>{short(receipt.hash, 6)}</code></span>
                  <span className={`rc-pill is-${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
                </button>
                {open && <div className="rc-explain">
                  {explainOf(receipt.step, receipt.hash)
                    ? <button type="button" className="why-btn" aria-haspopup="dialog" onClick={() => setExplainStep(receipt.step)}>Explain why · step {pad(receipt.step)}</button>
                    : <span className="rc-note">{explainError ? `Explanation unavailable: ${explainError}` : 'Explanation loading…'}</span>}
                </div>}
                {open && <dl className="rc-details">
                  <div><dt>Receipt hash</dt><dd><code>{receipt.hash}</code></dd></div>
                  <div><dt>Previous</dt><dd><code>{receipt.previousHash ?? 'GENESIS'}</code></dd></div>
                  <div><dt>Args hash · result hash</dt><dd><code>{receipt.argsHash.slice(0, 24)}… · {receipt.resultHash.slice(0, 24)}…</code></dd></div>
                  <div><dt>Signature</dt><dd><code>{receipt.signature.slice(0, 44)}…</code></dd></div>
                  <div><dt>Permissions</dt><dd><code>{receipt.permissions.join(', ') || 'none'}</code></dd></div>
                  {receipt.secretsAccessed && <div className="rc-details-warn"><dt>Policy</dt><dd>Signed as a secret access{receipt.outcome === 'denied' ? '; the proxy denied it before it ran' : ''}.</dd></div>}
                </dl>}
              </li>;
            })}</ol>
          </> : <div className="rc-empty">
            <Mark className="rc-empty-mark" />
            <strong>{loading ? 'Loading the session…' : data ? 'Recorder armed. Nothing recorded yet.' : 'Session unavailable'}</strong>
            <span>{loading || data ? 'Start the MCP proxy and call a tool. Each call is plotted here as a signed receipt.' : loadError || 'The dashboard could not read the local store.'}</span>
            <code>pnpm --filter @blackbox/proxy start</code>
          </div>}
        </section>

        <aside className="rc-side" aria-label="Controls">
          <section className="rc-panel rc-control">
            <span className="stencil">Tamper test</span>
            <h2>Break a block, watch it fail.</h2>
            <p>Edits a stored receipt on disk with the same store function as the CLI. Restore puts the signed original back.</p>
            <div className="rc-controls">
              <label className="sr" htmlFor="rc-step">Block to tamper</label>
              <select id="rc-step" className="rc-select" value={tamperStep} disabled={!receipts.length || busy} onChange={(event) => setTamperStep(Number(event.target.value))}>{receipts.length ? receipts.map((receipt) => <option key={receipt.step} value={receipt.step}>Block {pad(receipt.step)}</option>) : <option>No blocks</option>}</select>
              <button type="button" className="btn btn-danger btn-sm" disabled={!receipts.length || busy} onClick={() => void action('/api/tamper', { step: tamperStep })}>Tamper</button>
              <button type="button" className="btn btn-line btn-sm" disabled={!data?.tampered?.length || busy} onClick={() => void action('/api/restore')}>Restore</button>
              <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => void refresh()}>Re-verify</button>
            </div>
          </section>

          <section id="prove" className="rc-panel rc-control">
            <span className="stencil">Policy proof · {proofResult?.policyId ?? defaultSecretPolicy.id}</span>
            <h2>{!proofResult ? 'Did the agent read secrets?' : stale ? 'Proof is stale' : proofPass ? 'Pass: no secrets read' : failedStep === null ? 'Fail: property not proven' : `Fail at block ${pad(failedStep)}`}</h2>
            <p>{!proofResult ? 'Checks every step against secret path globs (.env*, *.pem, ~/.ssh, .git/**, .npmrc, .netrc and more) and secret patterns in tool args. Reveals inclusion paths and commitments, never the args.' : stale ? 'The log changed after this proof ran. Run it again to cover the current chain.' : proofPass ? `All ${proofResult.steps} signed blocks satisfy the policy, verified from the public key alone.` : proofResult.reason}</p>
            {failedStep !== null && data && explainOf(failedStep, receipts.find((receipt) => receipt.step === failedStep)?.hash ?? '') && <button type="button" className="why-btn rc-why-proof" aria-haspopup="dialog" onClick={() => setExplainStep(failedStep)}>Explain why block {pad(failedStep)} fails</button>}
            {proofPass && <div className="rc-proof"><code>{proofResult?.steps} / {receipts.length} leaves · root {proofResult?.root?.slice(0, 16)}…</code><button type="button" className="rc-link" onClick={downloadProof}>Download proof JSON</button></div>}
            <button type="button" className="btn btn-accent rc-wide" disabled={busy || !receipts.length} onClick={() => void proveNoSecrets()}>Prove: no secrets read</button>
          </section>

          <section className="rc-panel rc-control">
            <span className="stencil">Walrus storage</span>
            <h2>{data?.walrus ? 'Session blob stored' : data?.walrusConfigured ? 'Pin the session log' : 'Setup required'}</h2>
            {data?.walrus ? <code className="rc-blob">{typeof blobId === 'string' ? blobId : JSON.stringify(blobId)?.slice(0, 60)}</code>
              : <p>{data?.walrusConfigured ? 'Uploads the receipts and root to the configured publisher.' : 'Set WALRUS_PUBLISHER_URL to a funded publisher endpoint. None is bundled, and the root is not anchored on-chain.'}</p>}
            <button type="button" className="btn btn-line btn-sm" disabled={busy || !data?.walrusConfigured || !receipts.length} onClick={() => void action('/api/anchor')}>{data?.walrus ? 'Upload again' : 'Upload to Walrus'}</button>
          </section>
          {message && <p className="rc-notice" role="status">{message}</p>}
          <p className="rc-fine">Zetaris and Meterless lamps come from a live request on load; nothing is cached or simulated. Neither client is used in the agent loop yet.</p>
        </aside>
      </div>

      <section className="rc-wiring" aria-label="Wiring">
        <div className="rc-panel">
          <div className="rc-panel-head"><div><span className="stencil">MCP proxy</span><h2>Any MCP client</h2></div><span className={`rc-pill is-${receipts.length ? 'ok' : 'idle'}`}>{receipts.length ? `${receipts.length} recorded` : 'Waiting'}</span></div>
          <dl className="rc-kv">
            <div><dt>Start</dt><dd><code>pnpm --filter @blackbox/proxy start</code></dd></div>
            <div><dt>Transport</dt><dd><code>stdio · packages/proxy/dist/server.js</code></dd></div>
            <div><dt>Tools</dt><dd><code>read_file · write_file · git · shell · blackbox_explain</code></dd></div>
            <div><dt>Or proxy</dt><dd><code>server.js --upstream &quot;&lt;any stdio MCP server&gt;&quot;</code></dd></div>
            <div><dt>Store</dt><dd><code>{data?.source ?? 'RECEIPTS_DIR/session.jsonl'}</code></dd></div>
          </dl>
        </div>
        <div className="rc-panel">
          <div className="rc-panel-head"><div><span className="stencil">GitLab Duo</span><h2>Custom flow</h2></div><span className="rc-pill is-caution">Not yet run on GitLab</span></div>
          <dl className="rc-kv">
            <div><dt>Flow</dt><dd><code>.gitlab/duo/flows/blackbox-receipts.yaml</code></dd></div>
            <div><dt>Bridge</dt><dd><code>node packages/proxy/dist/call.js &lt;tool&gt; &apos;&lt;json&gt;&apos;</code></dd></div>
            <div><dt>CI</dt><dd><code>.gitlab-ci.yml</code></dd></div>
            <div><dt>IDE</dt><dd><code>.gitlab/duo/mcp.json</code></dd></div>
          </dl>
          <p className="rc-fine">Setup: docs/gitlab-setup.md. No Duo run or pipeline history exists yet.</p>
        </div>
      </section>

      <ExplainDrawer step={explanation && explainStep !== null ? explanation.steps.find((item) => item.step === explainStep) ?? null : null} verdict={explanation?.verdict ?? ''} source="Live: /api/explain runs the same explainer as blackbox-receipts explain --json over the local store." onClose={closeExplain} onSelect={setExplainStep} />

      <footer className="rc-foot">
        <p>Signatures prove what the proxy observed. They do not prove the proxy machine was uncompromised. TEE attestation is future work.</p>
        <p className="stencil">Blackbox Receipts · Ed25519 · SHA-256 · Merkle · MIT</p>
      </footer>
    </main>
  </div>;
}
