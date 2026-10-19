// Test-only session builder. App code must never import this.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReceipt, generateSigningKey, sha256, type Receipt, type Witness } from '../../packages/receipts/src/index.ts';

export type Call = { tool: string; args: Record<string, unknown>; paths?: string[]; secretsAccessed?: boolean };

export const cleanCalls: Call[] = [
  { tool: 'git', args: { action: 'status', args: [] }, paths: [] },
  { tool: 'read_file', args: { path: 'src/index.ts' }, paths: ['src/index.ts'] },
  { tool: 'shell', args: { command: 'ls -la src' }, paths: ['src'] },
  { tool: 'shell', args: { command: 'pwd' }, paths: [] },
  { tool: 'git', args: { action: 'diff', args: ['README.md'] }, paths: ['README.md'] },
];

export function buildSession(calls: Call[], sessionId = 'test-session') {
  const keys = generateSigningKey();
  const receipts: Receipt[] = [];
  const witnesses: Witness[] = [];
  calls.forEach((call, index) => {
    const step = index + 1;
    receipts.push(createReceipt({
      sessionId, step, timestamp: new Date(Date.UTC(2026, 9, 20, 12, 0, step)).toISOString(), tool: call.tool,
      argsHash: sha256(JSON.stringify(call.args)), paths: call.paths ?? [], secretsAccessed: call.secretsAccessed ?? false,
      permissions: [`workspace:${call.tool}`], cost: null, approver: null, resultHash: sha256(`result-${step}`),
      previousHash: receipts.at(-1)?.hash ?? null,
    }, keys.privateKey));
    witnesses.push({ sessionId, step, args: call.args });
  });
  return { keys, receipts, witnesses };
}

/** Writes a session in the proxy's on-disk layout so the real CLI can read it via RECEIPTS_DIR. */
export function writeSessionDir(session: ReturnType<typeof buildSession>): string {
  const dir = mkdtempSync(join(tmpdir(), 'blackbox-test-'));
  writeFileSync(join(dir, 'session.jsonl'), session.receipts.map((item) => `${JSON.stringify(item)}\n`).join(''));
  writeFileSync(join(dir, 'witness.jsonl'), session.witnesses.map((item) => `${JSON.stringify(item)}\n`).join(''));
  writeFileSync(join(dir, 'signing-key.pem'), session.keys.privateKey);
  writeFileSync(join(dir, 'public-key.pem'), session.keys.publicKey);
  return dir;
}
