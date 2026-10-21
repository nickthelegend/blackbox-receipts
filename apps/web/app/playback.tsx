'use client';

// The page's one animation: when the tape scrolls into view, a playhead sweeps across it once and each
// receipt appears as the playhead reaches its signed time; the caution lamp lights at the denied step.
// It replays the committed receipts, not a live feed. With reduced motion (or no JavaScript) the full
// tape is shown at once.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Tape, type TapeStep } from './components/strip';

export function Playback({ steps, label, alarmX, alarmText }: { steps: TapeStep[]; label: string; alarmX: number | null; alarmText: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [play, setPlay] = useState<'static' | 'ready' | 'run'>('static');
  const [canAnimate, setCanAnimate] = useState(false);

  useEffect(() => {
    const element = root.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    // Only hide the marks if the tape is not on screen yet, so nothing visible blinks out.
    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) return;
    setCanAnimate(true);
    setPlay('ready');
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setPlay('run'); observer.disconnect(); }
    }, { threshold: 0.45 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function replay() {
    setPlay('ready');
    requestAnimationFrame(() => requestAnimationFrame(() => setPlay('run')));
  }

  return <div ref={root} className="pb" data-play={play}>
    <div className="pb-bar">
      <span className="pb-rec"><i aria-hidden />Replay of committed receipts · not a live feed</span>
      {alarmX !== null && <span className="pb-caution" style={{ '--x': alarmX } as CSSProperties}>{alarmText}</span>}
      {canAnimate && <button type="button" className="pb-replay" onClick={replay} disabled={play === 'ready'}>Replay</button>}
    </div>
    <Tape steps={steps} label={label} />
  </div>;
}
