// The orange flight recorder, drawn from the recorded session's data. Used on the landing and on /evidence.
import type { Flight } from './flight';

const pad = (n: number) => String(n).padStart(2, '0');

export function RecorderUnit({ flight }: { flight: Flight }) {
  const denied = flight.steps.find((step) => step.secret);
  const ticks = flight.steps.map((step, index) => ({ x: 152 + index * (236 / Math.max(flight.steps.length - 1, 1)), alarm: step.secret, error: step.outcome === 'error' }));
  return <svg className="unit" viewBox="0 0 560 430" role="img" aria-labelledby="unit-title">
    <title id="unit-title">{`Drawing of an orange flight recorder labelled Agent Recorder, Do Not Edit. Its tape window shows ${flight.steps.length} receipts with step ${denied ? denied.step : 'none'} marked; its data plate reads session ${flight.sessionId.slice(0, 8)}, ${flight.sealCount} of ${flight.steps.length} receipts sealed.`}</title>
    {/* handle */}
    <rect x="196" y="18" width="168" height="62" rx="16" fill="none" stroke="#ff6b1a" strokeWidth="14" />
    {/* side face for depth */}
    <path d="M488 92 L520 72 L520 360 L488 392 Z" fill="#b8460a" />
    <path d="M60 92 L92 72 L520 72 L488 92 Z" fill="#ff8a4a" />
    {/* body */}
    <rect x="40" y="88" width="452" height="306" rx="14" fill="#ff6b1a" />
    {/* reflective stripes */}
    <rect x="40" y="110" width="452" height="12" fill="#f2eee8" opacity=".92" />
    <rect x="40" y="360" width="452" height="12" fill="#f2eee8" opacity=".92" />
    {/* stencil */}
    <text x="70" y="166" className="unit-stencil">AGENT RECORDER</text>
    <text x="70" y="196" className="unit-stencil unit-stencil-sm">DO NOT EDIT · NE PAS MODIFIER</text>
    {/* tape window */}
    <rect x="132" y="214" width="276" height="62" rx="6" fill="#120700" />
    <line x1="146" y1="245" x2="394" y2="245" stroke="#3a1c08" strokeWidth="2" />
    {ticks.map((tick, index) => <rect key={index} x={tick.x - 5} y={tick.alarm ? 226 : 236} width="10" height={tick.alarm ? 38 : 18} rx="2" fill={tick.alarm ? '#ff5b4f' : tick.error ? '#5b3a24' : '#f2eee8'} />)}
    {/* key slot */}
    <rect x="420" y="150" width="44" height="14" rx="7" fill="#1f0b00" />
    <rect x="432" y="154" width="20" height="6" rx="3" fill="#ff6b1a" opacity=".55" />
    {/* data plate */}
    <rect x="70" y="292" width="210" height="56" rx="4" fill="#1f0b00" />
    <text x="82" y="312" className="unit-plate">{`S/N ${flight.sessionId.slice(0, 8).toUpperCase()}`}</text>
    <text x="82" y="326" className="unit-plate">{`RCPT ${pad(flight.sealCount)}/${pad(flight.steps.length)} SEALED`}</text>
    <text x="82" y="340" className="unit-plate">{`ROOT ${flight.root.slice(0, 12).toUpperCase()}`}</text>
    {/* latch */}
    <rect x="404" y="300" width="60" height="40" rx="5" fill="#d9520a" />
    <rect x="414" y="314" width="40" height="12" rx="6" fill="#1f0b00" />
    {/* screws */}
    {[[56, 102], [476, 102], [56, 382], [476, 382]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5" fill="#d9520a" />)}
    {/* locator beacon */}
    <rect x="4" y="214" width="44" height="66" rx="10" fill="#1f0b00" />
    <rect x="0" y="228" width="10" height="38" rx="4" fill="#2c1405" />
    <line x1="14" y1="228" x2="40" y2="228" stroke="#ff6b1a" strokeWidth="2" opacity=".6" />
    <line x1="14" y1="266" x2="40" y2="266" stroke="#ff6b1a" strokeWidth="2" opacity=".6" />
    {/* part numbers */}
    {[[442, 140, '1'], [270, 214, '2'], [434, 300, '3'], [26, 214, '4']].map(([cx, cy, n]) => <g key={n} className="unit-callout"><circle cx={cx} cy={cy} r="13" /><text x={cx} y={Number(cy) + 4.5}>{n}</text></g>)}
  </svg>;
}
