'use client';

// Crash investigation: verifies the exported packs of the two committed agent runs in this tab with
// @blackbox/verify, the same code `verify-pack` runs. Signatures, hash links, the signed seal and the
// no-secrets proof are all computed here on click; nothing is precomputed and no request is made.
// Both runs were proven on 2026-10-21 under no-secrets-read/v1, the policy published then, so they are
// checked under that policy, as recorded (the default pin is now v2; see /verify to switch).
import { useState } from 'react';
import { noSecretsPolicyV1, parsePack, policyHash, verifyPack, type Pack, type PackResult } from '@blackbox/verify';
import failSample from './verify/samples/agent-fail.json';
import passSample from './verify/samples/agent-pass.json';

const EXHIBITS = [
  { id: 'A', file: 'agent-fail.json', text: JSON.stringify(failSample, null, 2), what: 'The run that tried to read .env' },
  { id: 'B', file: 'agent-pass.json', text: JSON.stringify(passSample, null, 2), what: 'The run that skipped the README’s .env request' },
];
const CHECK_LABEL: Record<PackResult['checks'][number]['name'], string> = { format: 'Pack format', key: 'Public key', chain: 'Signatures and hash links', seal: 'Signed seal (nothing cut off)', property: 'No-secrets proof' };
const STEP_LABEL = { ok: 'signed', broken: 'broken', untrusted: 'untrusted', flagged: 'secret access' } as const;

type Run = { exhibit: string; pack: Pack; result: PackResult; ms: number; edit: string | null };
const RECORDED_UNDER = { expectedPolicyHash: policyHash(noSecretsPolicyV1), expectedPolicyId: noSecretsPolicyV1.id };

function check(exhibit: string, text: string, edit: string | null): Run | string {
  try {
    const started = performance.now();
    const pack = parsePack(text);
    const result = verifyPack(pack, RECORDED_UNDER);
    return { exhibit, pack, result, ms: performance.now() - started, edit };
  } catch (error) { return error instanceof Error ? error.message : String(error); }
}

/** Changes one character of the pack text: a hex digit inside the chosen step's resultHash. */
function flipOneByte(text: string, pack: Pack, step: number): { text: string; offset: number } | null {
  const receipt = pack.receipts.find((item) => item.step === step);
  if (!receipt) return null;
  const from = text.indexOf(`"step": ${step},`);
  const at = text.indexOf(receipt.resultHash, from);
  if (from < 0 || at < 0) return null;
  const offset = at + 10;
  return { text: `${text.slice(0, offset)}${text[offset] === '0' ? '1' : '0'}${text.slice(offset + 1)}`, offset };
}

export function Investigation() {
  const [selected, setSelected] = useState('A');
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flipStep, setFlipStep] = useState(7);
  const exhibit = EXHIBITS.find((item) => item.id === selected) ?? EXHIBITS[0];

  function runChecks(text = exhibit.text, edit: string | null = null) {
    const next = check(exhibit.id, text, edit);
    if (typeof next === 'string') { setRun(null); setError(next); return; }
    setError(null); setRun(next);
  }
  function choose(id: string) { setSelected(id); setRun(null); setError(null); setFlipStep(7); }
  function tamper() {
    if (!run) return;
    const changed = flipOneByte(exhibit.text, run.pack, flipStep);
    if (!changed) { setError(`Could not find step ${flipStep}'s resultHash in ${exhibit.file}`); return; }
    runChecks(changed.text, `1 byte changed at offset ${changed.offset}, inside step ${flipStep}'s resultHash, in this tab only.`);
  }

  const current = run?.exhibit === exhibit.id ? run : null;
  const result = current?.result ?? null;
  return <div className="iv">
    <div className="iv-exhibits" role="radiogroup" aria-label="Evidence">
      {EXHIBITS.map((item) => {
        const pack = item.id === 'A' ? failSample : passSample;
        return <button key={item.id} type="button" role="radio" aria-checked={selected === item.id} className={`iv-tag${selected === item.id ? ' is-on' : ''}`} onClick={() => choose(item.id)}>
          <span className="iv-tag-hole" aria-hidden />
          <span className="iv-tag-id">Exhibit {item.id}</span>
          <strong>{item.what}</strong>
          <code>{item.file} · {pack.sessionId.slice(0, 8)} · {pack.receipts.length} receipts</code>
        </button>;
      })}
    </div>

    <div className={`iv-report${result ? (result.ok ? ' is-pass' : ' is-fail') : ''}`} aria-live="polite">
      {!current || !result ? <div className="iv-idle">
        <p className="stencil">Exhibit {exhibit.id} · sealed, not yet checked</p>
        <p>Runs format, key, chain, seal and proof checks on <code>{exhibit.file}</code> in this tab.</p>
        <button type="button" className="btn btn-accent" onClick={() => runChecks()}>Run the checks</button>
        {error && <p className="iv-error" role="alert">Could not verify: {error}</p>}
      </div> : <>
        <div className="iv-verdict">
          <span className="iv-stamp">{result.ok ? 'Pass' : 'Fail'}</span>
          <div>
            <p className="iv-headline">{result.headline}</p>
            <p className="iv-meta">Checked in {current.ms < 1 ? '<1' : current.ms.toFixed(1)} ms in this tab · policy {result.policyId}, the one in force when this run was recorded</p>
            {current.edit && <p className="iv-edit">{current.edit} The committed file is untouched.</p>}
          </div>
        </div>
        <ol className="iv-checks">{result.checks.map((item) => <li key={item.name} className={item.ok ? 'is-ok' : 'is-bad'}>
          <span aria-hidden>{item.ok ? '✓' : '✕'}</span><b>{CHECK_LABEL[item.name]}</b><span>{item.detail}</span>
        </li>)}</ol>
        <div className="iv-cells" aria-label="Per-step status">{result.steps.map((step) => <span key={step.step} className={`iv-cell is-${step.status}`} title={`Step ${step.step}: ${step.tool} ${step.paths.join(' ')} (${STEP_LABEL[step.status]})`}><b>{String(step.step).padStart(2, '0')}</b><small>{STEP_LABEL[step.status]}</small></span>)}</div>
        <div className="iv-tamper">
          <label className="stencil" htmlFor="iv-step">Tamper with the evidence</label>
          <div className="iv-tamper-row">
            <select id="iv-step" value={flipStep} onChange={(event) => setFlipStep(Number(event.target.value))}>{current.pack.receipts.map((receipt) => <option key={receipt.step} value={receipt.step}>Step {String(receipt.step).padStart(2, '0')}</option>)}</select>
            <button type="button" className="btn btn-line btn-sm" onClick={tamper}>Flip one byte and re-check</button>
            {current.edit && <button type="button" className="btn btn-line btn-sm" onClick={() => runChecks()}>Original file</button>}
          </div>
        </div>
        {error && <p className="iv-error" role="alert">{error}</p>}
      </>}
    </div>
  </div>;
}
