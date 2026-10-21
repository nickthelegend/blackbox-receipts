// Static marketing sections and the brand mark. Every claim here comes from the README; nothing is invented.

export function Mark({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 32 32" aria-hidden focusable="false">
    <rect x="11" y="3" width="10" height="6" rx="2.2" fill="none" stroke="#ff6b1a" strokeWidth="2.2" />
    <rect x="3" y="7.5" width="26" height="21" rx="5.5" fill="#ff6b1a" />
    <rect x="3" y="15.5" width="26" height="4.5" fill="#1f0b00" />
    <circle cx="24" cy="24.2" r="1.6" fill="#1f0b00" />
  </svg>;
}

export function Logo({ href = '#top' }: { href?: string }) {
  return <a className="logo" href={href} aria-label="Blackbox Receipts, home"><Mark /><span>Blackbox</span></a>;
}

const Arrow = () => <svg viewBox="0 0 20 20" aria-hidden focusable="false"><path d="M4 10h11m-4-4.5L15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Down = () => <svg viewBox="0 0 20 20" aria-hidden focusable="false"><path d="M10 4v11m-4.5-4L10 15.5 14.5 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export function Nav() {
  return <nav className="nav" aria-label="Primary">
    <div className="wrap">
      <ul>
        <li><a href="#how">How it works</a></li>
        <li><a href="#limits">Limits</a></li>
        <li><a href="#duo">Duo &amp; MCP</a></li>
      </ul>
      <Logo />
      <div className="act">
        <a href="/verify" className="act-link">Verify a pack</a>
        <a className="btn btn-white btn-sm" href="#app">Open recorder <Arrow /></a>
      </div>
    </div>
  </nav>;
}

export function HeroCopy() {
  return <div className="hero-copy">
    <p className="kicker"><span className="kicker-dot" aria-hidden />Flight recorder for AI agents</p>
    <h1 className="h-hero">Every agent action, signed and chained.</h1>
    <p className="lead">An MCP proxy in front of your agent’s tools writes an Ed25519-signed, hash-chained receipt for every call. Edit, reorder or cut one off the end and verification names the step.</p>
    <div className="cta">
      <a className="btn btn-accent" href="#app">Open the recorder <Arrow /></a>
      <a className="btn btn-ghost-light" href="#how">How it works</a>
    </div>
  </div>;
}

export function Bento() {
  return <section id="how" className="sec-light" aria-labelledby="how-title">
    <div className="wrap">
      <div className="sec-head">
        <h2 id="how-title" className="h-sec">From tool call to proof in three steps</h2>
        <a className="btn btn-outline btn-sm" href="#app">See it live <Down /></a>
      </div>
      <div className="bento">
        <article className="card c-tint">
          <div><span className="step">01 · Receipts</span><h3 className="h-card">Every call becomes a receipt.</h3></div>
          <div className="ui">
            <div className="ui-label">Fields in each signed receipt</div>
            <div className="chips mono-chips">
              {['tool', 'paths', 'outcome', 'argsHash', 'resultHash', 'previousHash', 'timestamp', 'signature'].map((field) => <span key={field} className={field === 'signature' ? 'on' : undefined}>{field}</span>)}
            </div>
            <p className="ui-note">Raw arguments go to a private witness file. The receipt carries only a salted hash of them; paths stay readable.</p>
          </div>
        </article>
        <article className="card c-deep">
          <div><span className="step">02 · Chain</span><h3 className="h-card">Each receipt seals the one before it.</h3></div>
          <div className="mini-chain" aria-label="Example layout of a three-block chain">
            <span className="example-label">Example layout</span>
            <div className="mini-block"><b>#01</b><code>previousHash: GENESIS</code></div>
            <div className="mini-link" aria-hidden />
            <div className="mini-block"><b>#02</b><code>previousHash: hash of #01</code></div>
            <div className="mini-link" aria-hidden />
            <div className="mini-block mini-broken"><b>#03</b><code>edited, signature fails</code></div>
            <p>Change one byte and its signature fails. Every block after it is untrusted.</p>
          </div>
        </article>
        <article className="card c-tint-2">
          <div><span className="step">03 · Verify</span><h3 className="h-card">Check it with the public key alone.</h3></div>
          <div className="ui">
            <div className="ui-label">Verifier outcomes</div>
            <div className="outcome"><span className="tag tag-ok">PASS</span><code>no-secrets-read: N/N receipts</code></div>
            <div className="outcome"><span className="tag tag-no">FAIL</span><code>at step K: Chain verification failed</code></div>
            <div className="outcome"><span className="tag tag-no">FAIL</span><code>read_file touched secret path</code></div>
            <p className="ui-note">Ed25519 · SHA-256 · Merkle paths · signed seal. <a href="/verify">Verify a pack in your browser</a></p>
          </div>
        </article>
      </div>
    </div>
  </section>;
}

const faqs: [string, string][] = [
  ['Can the agent rewrite its own log?', 'Not without the proxy’s signing key, which lives outside the workspace (~/.blackbox) and is never exposed to the agent’s tools. Editing, reordering or deleting receipts, or cutting them off the end, is detected and named. Whoever holds the key could sign a different log, so publish the public key and pin it when you verify.'],
  ['What does a receipt actually prove?', 'That this proxy observed and signed the call. It does not prove the host machine was uncompromised. There is no TEE attestation yet.'],
  ['Is the property proof zero knowledge?', 'No. It is selective disclosure with a trusted attester. The verifier checks signatures, Merkle inclusion and the proxy’s attestation, but it trusts the proxy key for the policy verdict over hidden args.'],
  ['Is the shell tool a sandbox?', 'No. It is a demo policy guard: shell accepts only direct pwd, ls and cat, and secret-path checks are glob heuristics. Use an isolated workspace.'],
  ['Are Zetaris and Meterless live?', 'The clients and the live-check panel exist, but no keys are configured, so the panel shows “Setup required”. Neither is used in the agent loop yet and no live call has run.'],
  ['Has the GitLab Duo flow run?', 'Not yet. The flow YAML, the receipts bridge and .gitlab-ci.yml are in the repo. There is no public GitLab repo, live Duo run or pipeline history yet.'],
  ['Is the session anchored anywhere?', 'Not by default. The root is not anchored on-chain. Walrus upload works only when WALRUS_PUBLISHER_URL points at a funded publisher, and none is bundled.'],
];

export function Faq() {
  return <section id="limits" className="dark" aria-labelledby="limits-title">
    <div className="wrap faq">
      <div>
        <h2 id="limits-title" className="h-sec">Honest limits</h2>
        <p className="lead muted">What the recorder proves, what it doesn’t, and what isn’t live yet.</p>
      </div>
      <div>{faqs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
    </div>
  </section>;
}
