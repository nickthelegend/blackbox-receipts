'use client';

// The step drawer: why one recorded call is what it is, from `blackbox-receipts explain --json`, and the
// receipts that explanation rests on. Used by the landing tape log (committed explain.json) and the live
// recorder (/api/explain over the local store). It shows what the explainer produced and nothing else.
import { useEffect, useRef } from 'react';
import type { ExplainStep } from '@blackbox/proxy/explain';

const FINDING: Record<ExplainStep['finding'], { label: string; tone: 'ok' | 'bad' | 'caution' | 'idle' }> = {
  allowed: { label: 'Allowed', tone: 'ok' },
  'tool-error': { label: 'Tool refused', tone: 'caution' },
  violation: { label: 'Policy violation', tone: 'bad' },
  untrusted: { label: 'Untrusted', tone: 'bad' },
  unchecked: { label: 'Not checkable', tone: 'caution' },
};
const pad = (n: number) => String(n).padStart(2, '0');

export function ExplainDrawer({ step, verdict, source, onClose, onSelect }: {
  step: ExplainStep | null;
  verdict: string;
  /** Where the explanation came from, shown in the footer. */
  source: string;
  onClose: () => void;
  /** Opens another step (a cited receipt). */
  onSelect: (step: number) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const open = step !== null;

  useEffect(() => {
    if (!open) return;
    returnTo.current ??= document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, step?.step, onClose]);
  useEffect(() => {
    if (open) return;
    returnTo.current?.focus();
    returnTo.current = null;
  }, [open]);

  if (!step) return null;
  const finding = FINDING[step.finding];
  // preventDefault keeps the mousedown from moving focus to <body> after the drawer has handed it back.
  return <div className="xd" onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); onClose(); } }}>
    <section className="xd-panel" role="dialog" aria-modal="true" aria-labelledby="xd-title">
      <header className="xd-head">
        <div>
          <p className="stencil">Explain why · step {pad(step.step)}</p>
          <h2 id="xd-title"><code>{step.command}</code></h2>
        </div>
        <button ref={closeRef} type="button" className="xd-close" onClick={onClose} aria-label="Close the explanation">
          <svg viewBox="0 0 16 16" aria-hidden><path d="M3 3l10 10M13 3L3 13" /></svg>
        </button>
      </header>
      <div className="xd-body">
        <p className="xd-facts">
          <span className={`xd-pill is-${finding.tone}`}>{finding.label}</span>
          <span>outcome <b>{step.outcome}</b></span>
          <span>{step.timestamp.slice(11, 19)} UTC</span>
        </p>
        {step.detail && <p className="xd-detail">{step.detail}</p>}
        <h3 className="stencil">Why</h3>
        <ol className="xd-why">{step.why.map((line) => <li key={line}>{line}</li>)}</ol>
        <h3 className="stencil">Cited receipts</h3>
        <ul className="xd-cites">
          {step.cites.map((cite) => <li key={`${cite.role}-${cite.step}`}>
            <button type="button" className="xd-cite" disabled={cite.step === step.step} onClick={() => onSelect(cite.step)} aria-label={cite.step === step.step ? `Step ${cite.step}, this call` : `Open the explanation of step ${cite.step}`}>
              <span className="xd-cite-n">{pad(cite.step)}</span>
              <span className="xd-cite-role">{cite.role}</span>
              <code className="xd-cite-hash">{cite.hash}</code>
              <span className="xd-cite-note">{cite.note}</span>
            </button>
          </li>)}
        </ul>
      </div>
      <footer className="xd-foot">
        <p>Session verdict: <code>{verdict}</code></p>
        <p className="xd-src">{source}</p>
      </footer>
    </section>
  </div>;
}
