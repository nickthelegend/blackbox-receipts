import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = { title: 'Blackbox Receipts — Proof over promises', description: 'Signed, tamper-evident records of AI agent tool calls.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
