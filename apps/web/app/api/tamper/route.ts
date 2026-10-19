import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dataDir, loadReceipts } from '@blackbox/proxy/store';

export const runtime = 'nodejs';

export async function POST() {
  const receipts = await loadReceipts();
  if (!receipts.length) return NextResponse.json({ error: 'Record a real tool call before running the tamper demonstration.' }, { status: 409 });
  const file = resolve(dataDir, 'session.jsonl');
  const lines = (await readFile(file, 'utf8')).trim().split('\n');
  const first = JSON.parse(lines[0]);
  first.tool = `${first.tool}-edited`;
  lines[0] = JSON.stringify(first);
  await writeFile(file, `${lines.join('\n')}\n`);
  return NextResponse.json({ editedStep: first.step });
}
