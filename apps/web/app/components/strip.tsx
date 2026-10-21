// The recorder tape: a strip chart of a session's tool calls. One channel per tool, each receipt plotted at
// its signed timestamp, and a stepped trace joining each receipt to the one whose hash it carries. Steps
// that need attention (a denied secret read, a broken signature) get a full-height band and a flag.
// Pure markup, no hooks: the landing renders it on the server and the dashboard renders it live.
import type { CSSProperties } from 'react';

export type TapeTone = 'ok' | 'error' | 'alarm' | 'broken' | 'untrusted';
export type TapeStep = { step: number; at: number; tool: string; tone: TapeTone; flag?: string };

const NICE_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400];

function tickLabel(seconds: number): string {
  if (seconds === 0) return 'T+0';
  if (seconds < 60) return `+${seconds}s`;
  if (seconds < 3600) return seconds % 60 ? `+${Math.floor(seconds / 60)}m${seconds % 60}s` : `+${seconds / 60}m`;
  return seconds % 3600 ? `+${(seconds / 3600).toFixed(1)}h` : `+${seconds / 3600}h`;
}

export function layoutTape(steps: TapeStep[]) {
  const times = steps.map((item) => item.at);
  const start = Math.min(...times);
  const span = Math.max(Math.max(...times) - start, 1000);
  const channels = [...new Set(steps.map((item) => item.tool))];
  const lastOnChannel = new Map<string, { x: number; lane: number }>();
  const marks = steps.map((item) => {
    const x = ((item.at - start) / span) * 100;
    const row = channels.indexOf(item.tool);
    // Two calls on one channel within ~6% of the width would overlap: put the second on a sub-lane.
    const previous = lastOnChannel.get(item.tool);
    const lane = previous && x - previous.x < 6 ? (previous.lane === 0 ? 1 : previous.lane * -1) : 0;
    lastOnChannel.set(item.tool, { x, lane });
    return { ...item, x, y: ((row + 0.5) / channels.length) * 100, lane };
  });
  const spanSeconds = span / 1000;
  const interval = NICE_SECONDS.find((value) => spanSeconds / value <= 6) ?? 86400;
  const ticks: { label: string; x: number }[] = [];
  for (let s = 0; s <= spanSeconds + 1e-9; s += interval) ticks.push({ label: tickLabel(s), x: (s / spanSeconds) * 100 });
  return { start, span, channels, marks, ticks };
}

export function Tape({ steps, label, playId }: { steps: TapeStep[]; label: string; playId?: string }) {
  if (!steps.length) return null;
  const { channels, marks, ticks } = layoutTape(steps);
  // Flags that would overlap a flag already placed keep their band but drop the label.
  let lastFlag = -100;
  const flags = marks.filter((mark) => mark.flag && mark.x - lastFlag >= 18 && ((lastFlag = mark.x), true));
  const trace = marks.map((mark, index) => (index === 0 ? `M${mark.x.toFixed(3)} ${mark.y.toFixed(3)}` : `H${mark.x.toFixed(3)} V${mark.y.toFixed(3)}`)).join(' ');
  return <div className="tape" role="img" aria-label={label} id={playId} style={{ '--rows': channels.length } as CSSProperties}>
    <div className="tape-body">
      {flags.length > 0 && <><span aria-hidden /><div className="tape-flags" aria-hidden>
        {flags.map((mark) => <span key={`flag-${mark.step}`} className={`tape-flag${mark.x > 62 ? ' at-end' : ''}`} style={{ left: `${mark.x}%`, '--x': mark.x } as CSSProperties}><i />{mark.flag}</span>)}
      </div></>}
      <div className="tape-labels" aria-hidden>{channels.map((name) => <span key={name}>{name}</span>)}</div>
      <div className="tape-plot" aria-hidden>
        {channels.map((name) => <div key={name} className="tape-row" />)}
        <svg className="tape-trace" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false"><path d={trace} /></svg>
        {marks.filter((mark) => mark.flag).map((mark) => <div key={`band-${mark.step}`} className="tape-band" style={{ left: `${mark.x}%`, '--x': mark.x } as CSSProperties} />)}
        {marks.map((mark) => <span key={mark.step} className={`tape-mark is-${mark.tone}`} style={{ left: `${mark.x}%`, top: `calc(${mark.y}% + ${mark.lane * 11}px)`, '--x': mark.x } as CSSProperties}>{String(mark.step).padStart(2, '0')}</span>)}
        <span className="tape-head" />
      </div>
    </div>
    <div className="tape-axis" aria-hidden>{ticks.map((tick, index) => <span key={tick.label} className={index === 0 ? 'is-start' : tick.x > 94 ? 'is-end' : undefined} style={{ left: `${tick.x}%` }}>{tick.label}</span>)}</div>
  </div>;
}
