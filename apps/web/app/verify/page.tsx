'use client';

// Offline verifier. A dropped pack is checked entirely in this tab by @blackbox/verify (the same code
// the CLI's verify-pack runs): Ed25519 signatures with @noble/curves, SHA-256 hash links, the signed
// seal and the no-secrets proof under the pinned policy. No request is made; the file never leaves the
// browser. The two samples are packs of real agent runs committed under receipts/agent-demo/. The pin
// defaults to no-secrets-read/v2; the samples were proven under v1 on 2026-10-21, so loading one pins v1,
// and switching the pin back to v2 shows that a v1 proof does not satisfy the current policy.
// The signer key is pinned the same way: loading a sample pins the committed demo key; a dropped pack is
// checked unpinned (amber "PASS (key not pinned)") until the viewer pins the key they expect. Pins a
// sample set are dropped again when the viewer loads their own pack; pins the viewer chose are kept.
import { useCallback, useMemo, useRef, useState } from 'react';
import { parsePack, policyHash, publishedPolicy, PUBLISHED_POLICIES, verifyPack, type Pack, type PackResult, type StepStatus } from '@blackbox/verify';
import { Logo } from '../components/brand';
import { recorder, route } from '../site';
import passSample from './samples/agent-pass.json';
import failSample from './samples/agent-fail.json';
import '../styles.css';
import './verify.css';

type Loaded = { name: string; text: string; pack: Pack; result: PackResult; edit: string | null; sample: boolean };
type KeyMode = 'none' | 'demo' | 'custom';
type KeyPin = { mode: KeyMode; custom: string };

// The proxy key that signed both committed sample runs (receipts/agent-demo/*/public-key.pem).
const DEMO_KEY = passSample.publicKey;
const KEY_OPTIONS: { value: KeyMode; label: string }[] = [
  { value: 'none', label: 'Not pinned (trust the pack’s own key)' },
  { value: 'demo', label: 'Committed demo key (the two samples)' },
  { value: 'custom', label: 'Paste a public key…' },
];
/** The PEM to pin, or undefined when nothing is pinned. An empty paste box pins nothing yet. */
const pinnedKey = ({ mode, custom }: KeyPin): string | undefined => (mode === 'demo' ? DEMO_KEY : mode === 'custom' && custom.trim() ? custom : undefined);

// Both committed runs were proven on 2026-10-21 under no-secrets-read/v1, the policy published then.
const RECORDED_POLICY = 'no-secrets-read/v1';
const SAMPLES = [
  { id: 'pass', label: 'Agent skipped the README’s .env request', tone: 'ok' as const, file: 'agent-pass.json', text: JSON.stringify(passSample, null, 2) },
  { id: 'fail', label: 'Agent tried to read .env', tone: 'bad' as const, file: 'agent-fail.json', text: JSON.stringify(failSample, null, 2) },
];
const POLICY_NOTE: Record<string, string> = {
  'no-secrets-read/v2': 'Current default. Adds git config and credentials, .npmrc, .netrc, .pgpass, .pypirc, .p12/.pfx, Docker, Kubernetes and GnuPG files, and the .ssh, .aws and .gnupg folders to v1.',
  'no-secrets-read/v1': 'Frozen as published on 2026-10-21, when the two sample runs were recorded. It does not list git credentials, .npmrc or .netrc.',
};

const STATUS: Record<StepStatus['status'], { label: string; tone: 'ok' | 'bad' | 'warn' | 'dim' }> = {
  ok: { label: 'Signed', tone: 'ok' },
  broken: { label: 'Broken', tone: 'bad' },
  untrusted: { label: 'Untrusted', tone: 'dim' },
  flagged: { label: 'Secret access', tone: 'warn' },
};
const CHECK_LABEL: Record<PackResult['checks'][number]['name'], string> = { format: 'Pack format', key: 'Public key', chain: 'Signatures and hash links', seal: 'Signed seal (nothing cut off)', property: 'No-secrets proof' };

function load(name: string, text: string, edit: string | null, sample: boolean, pin: string, key: KeyPin): Loaded | string {
  const policy = publishedPolicy(pin) ?? PUBLISHED_POLICIES[0];
  try {
    const pack = parsePack(text);
    return { name, text, pack, result: verifyPack(pack, { expectedPolicyHash: policyHash(policy), expectedPolicyId: policy.id, pinnedPublicKey: pinnedKey(key) }), edit, sample };
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Changes exactly one character of the pack file: a hex digit of the chosen step's resultHash. */
function flipOneByte(text: string, pack: Pack, step: number): { text: string; offset: number } | null {
  const receipt = pack.receipts.find((item) => item?.step === step);
  if (!receipt || typeof receipt.resultHash !== 'string') return null;
  const from = text.indexOf(`"step": ${step},`);
  const at = text.indexOf(receipt.resultHash, from);
  if (from < 0 || at < 0) return null;
  const offset = at + 10;
  const replacement = text[offset] === '0' ? '1' : '0';
  return { text: `${text.slice(0, offset)}${replacement}${text.slice(offset + 1)}`, offset };
}

const time = (timestamp: string) => (timestamp.length >= 19 ? timestamp.slice(11, 19) : timestamp);

export default function VerifyPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [flipStep, setFlipStep] = useState(1);
  const [pin, setPin] = useState(PUBLISHED_POLICIES[0].id);
  const [key, setKey] = useState<KeyPin>({ mode: 'none', custom: '' });
  // True while the pins are the ones a sample set (v1 and the demo key), not ones the viewer chose.
  const [samplePins, setSamplePins] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const accept = useCallback((name: string, text: string, edit: string | null, sample: boolean, policy: string, signer: KeyPin) => {
    const next = load(name, text, edit, sample, policy, signer);
    if (typeof next === 'string') { setLoaded(null); setError(`${name}: ${next}`); return; }
    setError(null);
    setLoaded(next);
    if (!edit) setFlipStep(Math.min(Math.max(1, Math.ceil(next.pack.receipts.length / 2)), next.pack.receipts.length || 1));
  }, []);

  function loadSample(file: string, text: string) {
    const signer = { ...key, mode: 'demo' as const };
    setPin(RECORDED_POLICY);
    setKey(signer);
    setSamplePins(true);
    accept(file, text, null, true, RECORDED_POLICY, signer);
  }

  /** Re-checks the loaded pack (and any one-byte edit) under another pinned policy. */
  function repin(policy: string) {
    setPin(policy);
    setSamplePins(false);
    if (loaded) accept(loaded.name, loaded.text, loaded.edit, loaded.sample, policy, key);
  }

  /** Re-checks the loaded pack against another expected signer key. */
  function rekey(signer: KeyPin) {
    setKey(signer);
    setSamplePins(false);
    if (loaded) accept(loaded.name, loaded.text, loaded.edit, loaded.sample, pin, signer);
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 20_000_000) { setLoaded(null); setError(`${file.name}: larger than 20 MB, which is not a pack this page will read`); return; }
    const text = await file.text();
    if (!samplePins) { accept(file.name, text, null, false, pin, key); return; }
    // The viewer's own pack is checked under the defaults, not the pins a sample set for itself.
    const policy = PUBLISHED_POLICIES[0].id;
    const signer = { ...key, mode: 'none' as const };
    setPin(policy);
    setKey(signer);
    setSamplePins(false);
    accept(file.name, text, null, false, policy, signer);
  }

  function flip() {
    if (!loaded) return;
    const changed = flipOneByte(loaded.text, loaded.pack, flipStep);
    if (!changed) { setError(`Could not find step ${flipStep}'s resultHash in this pack's text`); return; }
    accept(loaded.name, changed.text, `Changed 1 byte (offset ${changed.offset}, inside step ${flipStep}'s resultHash) in this tab only. The file on disk is untouched.`, loaded.sample, pin, key);
  }

  const result = loaded?.result;
  // A PASS whose signer nobody pinned is amber: the pack is consistent, but anyone could have made its key.
  const tone = !result ? 'idle' : !result.ok ? 'bad' : result.keyPinned ? 'ok' : 'warn';
  const badge = !result ? '' : !result.ok ? 'FAIL' : result.keyPinned ? 'PASS' : 'PASS (key not pinned)';
  const counts = useMemo(() => {
    const tally = { ok: 0, broken: 0, untrusted: 0, flagged: 0 };
    for (const item of result?.steps ?? []) tally[item.status]++;
    return tally;
  }, [result]);

  return <div className="vf">
    <a className="skip" href="#vf-main">Skip to verifier</a>
    <header className="vf-top">
      <div className="vf-wrap vf-top-row">
        <Logo href={route('/')} />
        <a className="vf-back" href={recorder.href}>{recorder.short}</a>
      </div>
    </header>

    <main id="vf-main" className="vf-wrap">
      <section className="vf-intro" aria-labelledby="vf-title">
        <p className="vf-kicker"><span aria-hidden className="vf-dot" />Offline verifier</p>
        <h1 id="vf-title" className="vf-h1">Check a pack in your browser.</h1>
        <p className="vf-lead">Drop a <code>blackbox-pack/v1</code> file. Every signature, hash link, the signed seal and the no-secrets proof are checked here, in this tab, by <code>@blackbox/verify</code>. Nothing is uploaded and no request is made.</p>
      </section>

      <section className="vf-load" aria-label="Load a pack">
        <label
          className={`vf-drop${dragging ? ' is-drag' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); void readFile(event.dataTransfer.files[0]); }}
        >
          <input ref={input} type="file" accept=".json,application/json" className="vf-file" onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ''; }} />
          <svg viewBox="0 0 24 24" aria-hidden className="vf-drop-icon"><path d="M12 15V4m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="vf-drop-title">Drop a pack here, or <u>choose a file</u></span>
          <span className="vf-drop-sub">Make one with <code>node packages/proxy/dist/cli.js pack</code></span>
        </label>
        <div className="vf-samples">
          <p className="vf-label">Or load a real agent run</p>
          {SAMPLES.map((sample) => <button key={sample.id} type="button" className={`vf-sample vf-sample-${sample.tone}`} onClick={() => loadSample(sample.file, sample.text)}>
            <span className="vf-sample-dot" aria-hidden />{sample.label}<span className="vf-sample-file">{sample.file}</span>
          </button>)}
          <div className="vf-policy">
            <label className="vf-label" htmlFor="vf-policy">Pinned policy</label>
            <span className="vf-select-wrap">
              <select id="vf-policy" value={pin} onChange={(event) => repin(event.target.value)}>
                {PUBLISHED_POLICIES.map((policy, index) => <option key={policy.id} value={policy.id}>{policy.id}{index === 0 ? ' (current)' : ' (before 2026-10-22)'}</option>)}
              </select>
            </span>
            <p className="vf-policy-note">{POLICY_NOTE[pin] ?? ''} A proof made under any other policy fails.</p>
          </div>
          <div className="vf-signer">
            <label className="vf-label" htmlFor="vf-signer">Expected signer key</label>
            <span className="vf-select-wrap">
              <select id="vf-signer" value={key.mode} onChange={(event) => rekey({ ...key, mode: event.target.value as KeyMode })}>
                {KEY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </span>
            {key.mode === 'custom' && <>
              <label className="vf-sr" htmlFor="vf-signer-pem">Signer public key (PEM)</label>
              <textarea id="vf-signer-pem" className="vf-pem" rows={4} spellCheck={false} placeholder={'-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----'} value={key.custom} onChange={(event) => rekey({ ...key, custom: event.target.value })} />
            </>}
            <p className="vf-policy-note">{key.mode === 'none' ? 'The pack carries its own key, so a PASS only shows it is internally consistent. Pin the key the proxy operator publishes (cli public-key) to trust who signed it.' : key.mode === 'demo' ? 'The key that signed both committed sample runs. A pack signed by any other key fails.' : 'Paste the PEM the proxy operator publishes. A pack signed by any other key fails.'}</p>
          </div>
        </div>
      </section>

      {error && <div className="vf-alert" role="alert"><strong>Could not verify.</strong> {error}</div>}

      {!loaded && !error && <section className="vf-empty" aria-label="No pack loaded">
        <p className="vf-empty-title">No pack loaded yet</p>
        <p>A pack holds a session&apos;s signed receipts, the proxy&apos;s public key, the seal and, when the prover passed, the proof. It never contains the private key or the agent&apos;s raw arguments.</p>
        <p>From a terminal, the same checks run with <code>npx ./blackbox-verify-0.1.0.tgz pack.json</code> (the tarball is in the repo&apos;s <code>release/</code> folder).</p>
      </section>}

      {loaded && result && <section className={`vf-result vf-${tone}`} aria-live="polite" aria-labelledby="vf-verdict">
        <div className="vf-verdict">
          <span className={`vf-badge vf-badge-${tone}`}>{badge}</span>
          <div className="vf-verdict-copy">
            <h2 id="vf-verdict" className="vf-headline">{result.headline}</h2>
            <p className="vf-meta"><span>{loaded.name}</span><span>policy {result.policyId}</span><span>session <code>{result.sessionId ?? 'none'}</code></span>{result.keyFingerprint && <span className="vf-fingerprint" title={`SHA-256 of the signer's Ed25519 key: ${result.keyFingerprint}`}>signer <code>{result.keyFingerprint.slice(0, 16)}</code>{result.keyPinned ? ' (pinned)' : ' (not pinned)'}</span>}</p>
            {loaded.sample && pin === RECORDED_POLICY && <p className="vf-policy-note">This sample was proven on 2026-10-21 under {RECORDED_POLICY}, so it is checked under that policy. Pin no-secrets-read/v2 to see that its proof does not satisfy the current policy.</p>}
            {loaded.edit && <p className="vf-edit">{loaded.edit}</p>}
          </div>
        </div>

        <ul className="vf-checks">
          {result.checks.map((check) => <li key={check.name} className={check.ok ? 'is-ok' : 'is-bad'}>
            <span className="vf-check-icon" aria-hidden>{check.ok ? '✓' : '✕'}</span>
            <span className="vf-check-name">{CHECK_LABEL[check.name]}</span>
            <span className="vf-check-detail">{check.detail}</span>
          </li>)}
        </ul>

        <div className="vf-tools">
          <p className="vf-label">Tamper test</p>
          <div className="vf-tools-row">
            <label className="vf-select-wrap">
              <span className="vf-sr">Step to edit</span>
              <select value={flipStep} onChange={(event) => setFlipStep(Number(event.target.value))}>
                {result.steps.map((item, index) => <option key={`${index}-${item.step}`} value={item.step}>Step {item.step}</option>)}
              </select>
            </label>
            <button type="button" className="vf-btn" onClick={flip}>Flip one byte</button>
            <button type="button" className="vf-btn vf-btn-ghost" onClick={() => input.current?.click()}>Load another pack</button>
          </div>
        </div>

        <div className="vf-steps-head">
          <h3>Receipts</h3>
          <p>{result.steps.length} steps · {counts.ok} signed{counts.flagged ? ` · ${counts.flagged} secret access` : ''}{counts.broken ? ` · ${counts.broken} broken` : ''}{counts.untrusted ? ` · ${counts.untrusted} untrusted` : ''}</p>
        </div>
        <ol className="vf-steps">
          {result.steps.map((item, index) => {
            const status = STATUS[item.status];
            return <li key={index} className={`vf-step vf-step-${status.tone}`}>
              <span className="vf-step-n">{String(item.step).padStart(2, '0')}</span>
              <div className="vf-step-main">
                <p className="vf-step-what"><strong>{item.tool}</strong>{item.paths.length > 0 && <code>{item.paths.join(' ')}</code>}</p>
                <p className="vf-step-sub">
                  <span>{time(item.timestamp)}</span>
                  {item.outcome && <span className={`vf-outcome vf-outcome-${item.outcome}`}>{item.outcome}</span>}
                  <span className="vf-hash">{item.hash.slice(0, 16)}…</span>
                </p>
                {item.reason && <p className="vf-step-reason">{item.reason}</p>}
              </div>
              <span className={`vf-pill vf-pill-${status.tone}`}>{status.label}</span>
            </li>;
          })}
        </ol>
        {result.root && <p className="vf-root">Merkle root <code>{result.root}</code></p>}
        <p className="vf-note">{result.keyPinned ? 'The pack was signed by the key you pinned.' : 'The public key comes from the pack itself, so this PASS shows only that the pack is internally consistent and was signed by that key.'} Pin a key under Expected signer key above, or with <code>BLACKBOX_PUBLIC_KEY</code> in <code>verify-pack</code>, and compare it with the one the proxy operator publishes (<code>cli public-key</code>).</p>
      </section>}
    </main>
  </div>;
}
