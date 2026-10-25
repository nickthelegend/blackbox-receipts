// Landing: one recorder, one promise. The hero is the orange flight recorder drawn from the recorded
// session; below it how it works, three numbers from that session and the test suite, and what is live vs
// Setup required. The tape playback, the investigation, the limitations placard and the hackathon window
// are on /evidence. All data comes from receipts/agent-demo/ at build time (see flight.ts).
import { Arrow, Logo } from './components/brand';
import { loadFlight } from './flight';
import { RecorderUnit } from './recorder-unit';
import { recorder, route } from './site';
import './landing.css';

export const dynamic = 'force-static';

const STEPS: [string, string][] = [
  ['Record', 'An MCP proxy signs a receipt for every tool call, chained to the one before.'],
  ['Seal', 'The session is sealed under a Merkle root. The key stays outside the workspace.'],
  ['Verify', 'Anyone checks the pack offline. An edit, reorder or cut names the step.'],
];

export default function Landing() {
  const flight = loadFlight();
  const denied = flight.steps.filter((step) => step.secret).length;

  return <div className="ld">
    <a className="skip" href="#main">Skip to content</a>
    <header className="ld-head">
      <div className="ld-wrap ld-head-row">
        <Logo href={route('/')} />
        <nav aria-label="Sections" className="ld-nav">
          <a href="#how">How it works</a>
          <a href="#proof">Proof</a>
          <a href={route('/evidence')}>Evidence</a>
          <a href={route('/verify')}>Verify a pack</a>
        </nav>
        <a className="btn btn-line btn-sm ld-head-cta" href={recorder.href}>{recorder.short} <Arrow /></a>
      </div>
    </header>

    <main id="main">
      <section className="ld-hero ld-hero-short ld-wrap" aria-labelledby="hero-title">
        <div className="ld-hero-copy">
          <p className="stencil ld-kicker">Flight recorder for AI agents</p>
          <h1 id="hero-title">Every tool call your agent makes, on the&nbsp;record.</h1>
          <p className="ld-lead">An MCP proxy signs a hash-chained receipt for every call. Edit or cut one, and verification names the step.</p>
          <div className="ld-cta">
            <a className="btn btn-accent" href={`${route('/evidence')}#playback`}>Play back a real run <Arrow /></a>
            <a className="btn btn-line" href={route('/verify')}>Verify a pack</a>
          </div>
        </div>
        <figure className="ld-unit">
          <RecorderUnit flight={flight} />
          <figcaption className="ld-unit-cap">Drawn from recorded session {flight.sessionId.slice(0, 8)}: {flight.steps.length} receipts, sealed.</figcaption>
        </figure>
      </section>

      <section id="how" className="ld-section" aria-labelledby="how-title">
        <div className="ld-wrap">
          <h2 id="how-title" className="ld-band-h">Three steps from a tool call to a verdict.</h2>
          <ol className="ld-steps">
            {STEPS.map(([title, body], index) => <li key={title}>
              <p className="stencil">0{index + 1}</p>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>)}
          </ol>
        </div>
      </section>

      <section id="proof" className="ld-section" aria-labelledby="proof-title">
        <div className="ld-wrap">
          <h2 id="proof-title" className="ld-band-h">A real agent asked for .env. The tape caught it.</h2>
          <dl className="ld-big">
            <div><dt>Receipts</dt><dd>{flight.steps.length}</dd></div>
            <div><dt>Denied</dt><dd>{denied}</dd></div>
            <div><dt>Tests</dt><dd>91</dd></div>
          </dl>
          <a className="ld-more" href={route('/evidence')}>See the evidence <Arrow /></a>
        </div>
      </section>

      <section id="live" className="ld-section" aria-labelledby="live-title">
        <div className="ld-wrap">
          <h2 id="live-title" className="ld-band-h">What’s live today</h2>
          <div className="ld-status">
            <div><h3><i className="is-ok" aria-hidden />Live</h3><p>The offline verifier and both recorded runs’ packs, checked in your browser.</p></div>
            <div><h3><i aria-hidden />Setup required</h3><p>Zetaris and Meterless need API keys. The GitLab Duo flow has not run yet.</p></div>
          </div>
        </div>
      </section>

      <section className="ld-section ld-install" aria-labelledby="install-title">
        <div className="ld-wrap ld-install-row">
          <div>
            <h2 id="install-title">Put it between your agent and its tools.</h2>
            <p>Point any MCP client at the proxy, or wrap an existing stdio MCP server.</p>
          </div>
          <div className="ld-install-box">
            <pre><code>pnpm --filter @blackbox/proxy start{'\n'}node packages/proxy/dist/server.js --upstream &quot;&lt;stdio MCP server&gt;&quot;{'\n'}pnpm dev   # dashboard at localhost:3000/recorder</code></pre>
            <div className="ld-cta">
              <a className="btn btn-accent" href={recorder.href}>{recorder.long} <Arrow /></a>
              <a className="btn btn-line" href={route('/verify')}>Verify a pack</a>
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
