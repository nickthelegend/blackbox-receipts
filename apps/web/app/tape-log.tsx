'use client';

// The landing's tape log: one row per signed receipt of the recorded run. Each row opens the step drawer
// with that step's explanation from the committed explain.json (`blackbox-receipts explain --json`).
import { useCallback, useState } from 'react';
import type { ExplainStep } from '@blackbox/proxy/explain';
import { ExplainDrawer } from './components/explain-drawer';

export type LogRow = { step: number; offset: string; command: string; outcome: string; note: string | null; tone: 'alarm' | 'error' | 'ok'; explain: ExplainStep | null };
const pad = (n: number) => String(n).padStart(2, '0');

export function TapeLog({ rows, verdict, source }: { rows: LogRow[]; verdict: string; source: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const current = rows.find((row) => row.step === open)?.explain ?? null;
  return <>
    <ol className="ld-log" aria-label="Tape log">
      {rows.map((row) => <li key={row.step} id={`step-${row.step}`} className={row.tone === 'alarm' ? 'is-alarm' : row.tone === 'error' ? 'is-error' : undefined}>
        <span className="ld-log-n">{pad(row.step)}</span>
        <span className="ld-log-t">{row.offset}</span>
        <code className="ld-log-cmd" title={row.command}>{row.command}</code>
        <span className="ld-log-out">{row.outcome}</span>
        {row.explain && <button type="button" className="why-btn ld-log-why" aria-haspopup="dialog" onClick={() => setOpen(row.step)} aria-label={`Explain why step ${row.step} is ${row.outcome}`}>Why</button>}
        {row.note && <span className="ld-log-note">{row.note}</span>}
      </li>)}
    </ol>
    <ExplainDrawer step={current} verdict={verdict} source={source} onClose={close} onSelect={setOpen} />
  </>;
}
