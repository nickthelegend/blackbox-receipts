// The brand mark (an orange recorder unit with its handle and locator beacon) and the logo lockup.

export function Mark({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 32 32" aria-hidden focusable="false">
    <rect x="11" y="3" width="10" height="6" rx="2.2" fill="none" stroke="#ff6b1a" strokeWidth="2.2" />
    <rect x="3" y="7.5" width="26" height="21" rx="5.5" fill="#ff6b1a" />
    <rect x="3" y="15.5" width="26" height="4.5" fill="#1f0b00" />
    <circle cx="24" cy="24.2" r="1.6" fill="#1f0b00" />
  </svg>;
}

export function Logo({ href = '/', tag }: { href?: string; tag?: string }) {
  return <a className="logo" href={href} aria-label="Blackbox Receipts, home"><Mark /><span>Blackbox</span>{tag && <small>{tag}</small>}</a>;
}

export const Arrow = () => <svg viewBox="0 0 20 20" aria-hidden focusable="false"><path d="M4 10h11m-4-4.5L15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
export const Down = () => <svg viewBox="0 0 20 20" aria-hidden focusable="false"><path d="M10 4v11m-4.5-4L10 15.5 14.5 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
