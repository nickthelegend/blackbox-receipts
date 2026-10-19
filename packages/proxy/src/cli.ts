import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { merkleRoot, proveNoSecrets, verifyChain } from '@blackbox/receipts';
import { loadReceipts, signingKeys, dataDir } from './store.js';

const receipts = await loadReceipts();
const keys = await signingKeys();
const command = process.argv[2] ?? 'verify';
if (command === 'verify') {
  const result = receipts.length ? verifyChain(receipts, keys.publicKey) : { valid: false, brokenAt: null, reason: 'No receipts exist for this session' };
  const root = merkleRoot(receipts.map(({ hash }) => hash));
  console.log(JSON.stringify({ ...result, receipts: receipts.length, root, sessionId: receipts[0]?.sessionId ?? null }, null, 2));
  if (!result.valid) process.exitCode = 1;
} else if (command === 'prove-no-secrets') {
  const result = proveNoSecrets(receipts, keys.publicKey);
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
} else if (command === 'tamper') {
  if (!receipts.length) throw new Error('No receipts exist to tamper with');
  const file = resolve(dataDir, 'session.jsonl');
  const lines = (await readFile(file, 'utf8')).trim().split('\n');
  const entry = JSON.parse(lines[0]);
  entry.tool = `${entry.tool}-edited`;
  lines[0] = JSON.stringify(entry);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, `${lines.join('\n')}\n`);
  console.log(`Edited receipt 1 in ${file}`);
} else {
  console.error('Usage: blackbox-receipts [verify|prove-no-secrets|tamper]');
  process.exitCode = 2;
}
