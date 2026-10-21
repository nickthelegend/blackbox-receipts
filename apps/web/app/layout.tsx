import type { Metadata, Viewport } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Blackbox Receipts — Proof over promises',
  description: 'A flight recorder for AI agents: an MCP proxy writes an Ed25519-signed, hash-chained receipt for every tool call, and a verifier (CLI or offline in the browser) names the step that was edited.',
  applicationName: 'Blackbox Receipts',
};
export const viewport: Viewport = { themeColor: '#0b0d10', width: 'device-width', initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
