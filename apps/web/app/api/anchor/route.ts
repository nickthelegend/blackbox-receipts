import { NextResponse } from 'next/server';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { merkleRoot } from '@blackbox/receipts';
import { dataDir, loadReceipts, signingKeys } from '@blackbox/proxy/store';

export const runtime = 'nodejs';

export async function POST() {
  const publisher = process.env.WALRUS_PUBLISHER_URL;
  if (!publisher) return NextResponse.json({ error: 'Walrus is not configured. Set WALRUS_PUBLISHER_URL to a funded publisher endpoint.' }, { status: 503 });
  const receipts = await loadReceipts();
  if (!receipts.length) return NextResponse.json({ error: 'There are no session receipts to anchor.' }, { status: 409 });
  const keys = await signingKeys();
  const root = merkleRoot(receipts.map(({ hash }) => hash));
  const payload = JSON.stringify({ sessionId: receipts[0].sessionId, root, publicKey: keys.publicKey, receipts });
  let response: Response;
  try {
    const url = new URL('/v1/blobs?epochs=1', publisher);
    response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: payload });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Walrus publisher request failed: ${reason}` }, { status: 502 });
  }
  const responseText = await response.text();
  if (!response.ok) return NextResponse.json({ error: `Walrus publisher returned ${response.status}: ${responseText.slice(0, 300)}` }, { status: 502 });
  let parsed: unknown;
  try { parsed = JSON.parse(responseText); } catch { parsed = { response: responseText }; }
  const record = { submittedAt: new Date().toISOString(), root, blob: parsed };
  await writeFile(resolve(dataDir, 'walrus.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  return NextResponse.json(record);
}
