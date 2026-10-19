import { NextResponse } from 'next/server';
import { merkleRoot, proveNoSecrets, verifyChain } from '@blackbox/receipts';
import { loadReceipts, signingKeys, sessionId, dataDir } from '@blackbox/proxy/store';
import { existsSync } from 'node:fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const receipts = await loadReceipts();
  const keys = await signingKeys();
  const chain = verifyChain(receipts, keys.publicKey);
  const root = merkleRoot(receipts.map(({ hash }) => hash));
  const property = proveNoSecrets(receipts, keys.publicKey);
  const walrus = existsSync(`${dataDir}/walrus.json`) ? JSON.parse(await (await import('node:fs/promises')).readFile(`${dataDir}/walrus.json`, 'utf8')) : null;
  return NextResponse.json({ sessionId: receipts[0]?.sessionId ?? sessionId, receipts, chain, root, property, publicKey: keys.publicKey, walrus });
}

export async function DELETE() {
  const { resetSession } = await import('@blackbox/proxy/store');
  await resetSession();
  return NextResponse.json({ ok: true });
}
