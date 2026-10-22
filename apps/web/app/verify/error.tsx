'use client';

// Last line of defence for /verify: if rendering a pack ever throws, the viewer gets a readable
// "Could not verify" instead of a blank page. verifyPack already turns malformed packs into a located
// FAIL, so reaching this means a bug in the page, never a verdict about the pack.
import { Logo } from '../components/brand';
import { route } from '../site';
import '../styles.css';
import './verify.css';

export default function VerifyError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="vf">
    <header className="vf-top">
      <div className="vf-wrap vf-top-row">
        <Logo href={route('/')} />
      </div>
    </header>
    <main className="vf-wrap">
      <section className="vf-intro">
        <p className="vf-kicker"><span className="vf-dot" aria-hidden />Offline verifier</p>
        <h1 className="vf-h1">Could not verify</h1>
        <p className="vf-lead">This pack could not be displayed, so no verdict was reached. Nothing was uploaded; the file never left this tab.</p>
      </section>
      <p className="vf-alert" role="alert">Could not verify: {error.message || 'the page failed while showing this pack'}</p>
      <button type="button" className="vf-btn" onClick={reset}>Load another pack</button>
    </main>
  </div>;
}
