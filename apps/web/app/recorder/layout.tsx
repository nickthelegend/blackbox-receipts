import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Recorder · Blackbox Receipts' };
export default function RecorderLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
