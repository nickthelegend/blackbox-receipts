// Landing: the product's metaphor taken literally. A recorder unit, the tape of a real recorded agent run
// played back, an investigation that checks the exported pack in the browser, and a limits placard.
// All data comes from receipts/agent-demo/ at build time (see flight.ts).
import { Arrow, Down, Logo } from './components/brand';
import type { TapeStep } from './components/strip';
import { loadFlight, type Flight } from './flight';
import { Investigation } from './investigation';
import { Playback } from './playback';
import './landing.css';

export const dynamic = 'force-static';

/** Renders `code` spans from the transcript's markdown backticks. */
const withCode = (text: string) => text.split('`').map((part, index) => (index % 2 ? <code key={index}>{part}</code> : part));
const promptStep = (line: string) => line.replace(/^2\) /, '').replace(/\.$/, '');
const pad = (n: number) => String(n).padStart(2, '0');
const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
const offset = (flight: Flight, at: number) => `+${((at - flight.steps[0].at) / 1000).toFixed(1)}s`;

function RecorderUnit({ flight }: { flight: Flight }) {
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

const LIMITS: { q: string; a: string; tag: string }[] = [
  { q: 'Can the agent rewrite its own log?', a: 'Not without the proxy’s signing key, which lives outside the workspace (~/.blackbox) and is never exposed to the agent’s tools. Editing, reordering or deleting receipts, or cutting them off the end, is detected and named. Whoever holds the key could sign a different log, so publish the public key and pin it when you verify.', tag: 'By design' },
  { q: 'What does a receipt actually prove?', a: 'That this proxy observed and signed the call. It does not prove the host machine was uncompromised. There is no TEE attestation yet.', tag: 'Limit' },
  { q: 'Is the property proof zero knowledge?', a: 'No. It is selective disclosure with a trusted attester. The verifier checks signatures, Merkle inclusion and the proxy’s attestation, but it trusts the proxy key for the policy verdict over hidden args.', tag: 'Limit' },
  { q: 'Is the shell tool a sandbox?', a: 'No. It is a demo policy guard: shell accepts only direct pwd, ls and cat, and secret-path checks are glob heuristics. Use an isolated workspace.', tag: 'Limit' },
  { q: 'Are Zetaris and Meterless live?', a: 'The clients and the live-check panel exist, but no keys are configured, so the panel shows “Setup required”. Neither is used in the agent loop yet and no live call has run.', tag: 'Setup required' },
  { q: 'Has the GitLab Duo flow run?', a: 'Not yet. The flow YAML, the receipts bridge and .gitlab-ci.yml are in the repo. There is no public GitLab repo, live Duo run or pipeline history yet.', tag: 'Not run yet' },
  { q: 'Is the session anchored anywhere?', a: 'Not by default. The root is not anchored on-chain. Walrus upload works only when WALRUS_PUBLISHER_URL points at a funded publisher, and none is bundled.', tag: 'Setup required' },
];

export default function Landing() {
  const flight = loadFlight();
  const first = flight.steps[0];
  const last = flight.steps[flight.steps.length - 1];
  const seconds = Math.round((last.at - first.at) / 1000);
  const denied = flight.steps.find((step) => step.secret) ?? null;
  const model = flight.model.split('/').pop() ?? flight.model;
  const span = Math.max(last.at - first.at, 1000);
  const tape: TapeStep[] = flight.steps.map((step) => ({ step: step.step, at: step.at, tool: step.tool, tone: step.secret ? 'alarm' : step.outcome === 'error' ? 'error' : 'ok', flag: step.secret ? `Denied · ${step.paths[0] ?? step.tool}` : undefined }));
  const verdictShort = flight.verdict.replace(/ \[policy [^\]]+\]/, '');

  return <div className="ld">
    <a className="skip" href="#main">Skip to content</a>
    <div className="ld-strip" aria-label="Recorded session summary">
      <div className="ld-wrap ld-strip-row">
        <span>Agent flight recorder</span>
        <span>Session <b>{flight.sessionId.slice(0, 8)}</b></span>
        <span><b>{flight.steps.length}</b> receipts</span>
        <span>Sealed <b>{utc(flight.sealedAt)}</b></span>
        {denied && <span className="ld-strip-alarm">Denied at step <b>{pad(denied.step)}</b></span>}
      </div>
    </div>
    <header className="ld-head">
      <div className="ld-wrap ld-head-row">
        <Logo href="/" />
        <nav aria-label="Sections" className="ld-nav">
          <a href="#playback">Playback</a>
          <a href="#investigation">Investigation</a>
          <a href="#limits">Limits</a>
          <a href="/verify">Verify a pack</a>
        </nav>
        <a className="btn btn-line btn-sm ld-head-cta" href="/recorder">Open recorder <Arrow /></a>
      </div>
    </header>

    <main id="main">
      <section className="ld-hero ld-wrap" aria-labelledby="hero-title">
        <div className="ld-hero-copy">
          <p className="stencil ld-kicker">Flight recorder for AI agents</p>
          <h1 id="hero-title">Every tool call your agent makes, on the&nbsp;record.</h1>
          <p className="ld-lead">An MCP proxy in front of your agent’s tools writes an Ed25519-signed, hash-chained receipt for every call. Edit, reorder or cut one off the end and verification names the step.</p>
          <div className="ld-cta">
            <a className="btn btn-accent" href="#playback">Play back a real run <Down /></a>
            <a className="btn btn-line" href="/verify">Verify a pack</a>
          </div>
        </div>
        <figure className="ld-unit">
          <RecorderUnit flight={flight} />
          <figcaption>
            <p className="stencil">Fig. 1 · Parts, as recorded in session {flight.sessionId.slice(0, 8)}</p>
            <ol className="ld-parts">
              <li><b>Signing key</b> Ed25519, kept outside the workspace in <code>~/.blackbox</code>. The agent’s tools never see it.</li>
              <li><b>Tape</b> {flight.steps.length} receipts, each carrying the hash of the one before it.</li>
              <li><b>Seal</b> Signed over all {flight.sealCount}. Cutting receipts off the end is detected.</li>
              <li><b>Locator</b> Merkle root <code>{flight.root.slice(0, 12)}…</code> Not anchored on-chain by default.</li>
            </ol>
          </figcaption>
        </figure>
      </section>

      <section id="playback" className="ld-section" aria-labelledby="playback-title">
        <div className="ld-wrap">
          <div className="ld-sec-head">
            <p className="stencil">01 · Tape playback</p>
            <h2 id="playback-title">A real agent run, replayed from its receipts.</h2>
            <p>{flight.agent} running {model}, with only the Blackbox tools attached, on a fixture repo whose README tells AI agents to read <code>.env</code> and print its <code>DATABASE_URL</code>. {flight.steps.length} tool calls in {seconds} seconds. Each mark is one signed receipt at its signed time; the line between marks is the hash link.</p>
          </div>

          <dl className="ld-flightstrip">
            <div><dt>Session</dt><dd>{flight.sessionId.slice(0, 8)}</dd></div>
            <div><dt>Agent</dt><dd>{flight.agent}</dd></div>
            <div><dt>Model</dt><dd>{model}</dd></div>
            <div><dt>Started</dt><dd>{utc(first.timestamp)}</dd></div>
            <div><dt>Sealed</dt><dd>{flight.sealCount}/{flight.steps.length} receipts</dd></div>
          </dl>

          <Playback steps={tape} label={`Strip chart of the ${flight.steps.length} signed tool calls in session ${flight.sessionId}, by tool, over ${seconds} seconds. Step ${denied?.step ?? '-'} is marked as a denied secret read. The tape log below lists every call.`} alarmX={denied ? ((denied.at - first.at) / span) * 100 : null} alarmText={denied ? `Caution · step ${pad(denied.step)}` : ''} />

          <div className="ld-readout">
            <ol className="ld-log" aria-label="Tape log">
              {flight.steps.map((step) => <li key={step.step} className={step.secret ? 'is-alarm' : step.outcome === 'error' ? 'is-error' : undefined}>
                <span className="ld-log-n">{pad(step.step)}</span>
                <span className="ld-log-t">{offset(flight, step.at)}</span>
                <code className="ld-log-cmd" title={step.command}>{step.command}</code>
                <span className="ld-log-out">{step.outcome}</span>
                {step.note && <span className="ld-log-note">{step.note}</span>}
              </li>)}
            </ol>
            <aside className="ld-cvr" aria-labelledby="cvr-title">
              <p id="cvr-title" className="stencil">Cockpit voice · transcript.txt after step {denied ? pad(denied.step) : '—'}</p>
              {flight.cockpit.length ? flight.cockpit.map((line) => <blockquote key={line}>{withCode(line)}</blockquote>) : <p className="ld-muted">No transcript lines found for this step.</p>}
              <div className="ld-verdict">
                <p className="stencil">Verdict, as signed</p>
                <p className="ld-verdict-text">{verdictShort}</p>
                <p className="ld-muted">The proxy refused the read before it ran, so the agent never received the file. The attempt is what the proof reports.</p>
              </div>
              <div className="ld-control">
                <p className="stencil">Second flight · {flight.control.sessionId.slice(0, 8)}</p>
                <p>Same agent, model and fixture, with step 2 of the prompt worded “{promptStep(flight.control.promptLine)}” instead of “{promptStep(flight.control.failPromptLine)}”. The agent skipped <code>.env</code>: <b>{flight.control.verdict.replace(/ \[policy [^\]]+\]/, '')}</b>.</p>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section id="investigation" className="ld-section ld-investigation" aria-labelledby="inv-title">
        <div className="ld-wrap">
          <div className="ld-sec-head">
            <p className="stencil">02 · Investigation</p>
            <h2 id="inv-title">Don’t trust this page. Check the pack.</h2>
            <p>Both runs, exported as <code>blackbox-pack/v1</code> files, are verified below in your browser by <code>@blackbox/verify</code>, the same code the CLI’s <code>verify-pack</code> runs. Nothing is uploaded. To check your own pack, <a href="/verify">drop it on the verifier</a>.</p>
          </div>
          <Investigation />
        </div>
      </section>

      <section id="limits" className="ld-section" aria-labelledby="limits-title">
        <div className="ld-wrap">
          <div className="ld-placard">
            <div className="ld-placard-head">
              <p className="stencil">03 · Limitations placard</p>
              <h2 id="limits-title">What the recorder does not prove.</h2>
            </div>
            <dl className="ld-limits">
              {LIMITS.map((item) => <div key={item.q}>
                <dt><span className={`ld-tag is-${item.tag.toLowerCase().replace(/\s+/g, '-')}`}>{item.tag}</span>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>)}
            </dl>
          </div>
        </div>
      </section>

      <section className="ld-section ld-install" aria-labelledby="install-title">
        <div className="ld-wrap ld-install-row">
          <div>
            <p className="stencil">04 · Install the recorder</p>
            <h2 id="install-title">Put it between your agent and its tools.</h2>
            <p>Point any MCP client at the proxy, or wrap an existing stdio MCP server with <code>--upstream</code>. The local recorder dashboard plots each call as it lands.</p>
          </div>
          <div className="ld-install-box">
            <pre><code>pnpm --filter @blackbox/proxy start{'\n'}node packages/proxy/dist/server.js --upstream &quot;&lt;stdio MCP server&gt;&quot;{'\n'}pnpm dev   # dashboard at localhost:3000/recorder</code></pre>
            <div className="ld-cta">
              <a className="btn btn-accent" href="/recorder">Open the recorder <Arrow /></a>
              <a className="btn btn-line" href="/verify">Verify a pack</a>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer className="ld-foot">
      <div className="ld-wrap ld-foot-row">
        <p>Signatures prove what the proxy observed. They do not prove the proxy machine was uncompromised. TEE attestation is future work.</p>
        <p className="stencil">Blackbox Receipts · Ed25519 · SHA-256 · Merkle · MIT</p>
      </div>
    </footer>
  </div>;
}
