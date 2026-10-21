import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { verifyChain, type Receipt } from '../packages/receipts/src/index.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';

// Parallel tool calls must still produce one unbroken chain: steps 1..N, each linked to the previous.
const repoRoot = resolve(import.meta.dirname, '..');
const run = promisify(execFile);

function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-concurrency-'));
  for (let index = 1; index <= 20; index++) writeFileSync(join(cwd, `note-${index}.md`), `note ${index}\n`);
  const dataDir = join(cwd, '.blackbox');
  return { cwd, dataDir, env: { RECEIPTS_DIR: dataDir, RECEIPTS_RESUME: undefined } };
}

function log(dataDir: string): { receipts: Receipt[]; publicKey: string } {
  const receipts = readFileSync(join(dataDir, 'session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
  return { receipts, publicKey: readFileSync(join(dataDir, 'public-key.pem'), 'utf8') };
}

test('20 parallel calls through one proxy: steps 1..20, chain verifies', async () => {
  const ws = workspace();
  const client = await connectProxy({ cwd: ws.cwd, env: ws.env });
  try {
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => client.callTool({ name: 'read_file', arguments: { path: `note-${index + 1}.md` } })));
    assert.ok(results.every((result) => !result.isError));
  } finally { await client.close(); }
  const { receipts, publicKey } = log(ws.dataDir);
  assert.deepEqual(receipts.map((item) => item.step), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(receipts.filter((item) => item.previousHash === null).length, 1);
  assert.equal(new Set(receipts.map((item) => item.paths[0])).size, 20);
  assert.deepEqual(verifyChain(receipts, publicKey), { valid: true, brokenAt: null, reason: null });
});

test('6 bridge processes at once on a fresh directory: one key, steps 1..6, chain verifies', async () => {
  const ws = workspace();
  const tsx = import.meta.resolve('tsx');
  const env = { ...process.env, RECEIPTS_DIR: ws.dataDir, RECEIPTS_RESUME: '1' };
  // No session and no signing key exist yet, so the processes also race to create the key.
  await Promise.all(Array.from({ length: 6 }, (_, index) => run(process.execPath, ['--conditions=source', '--import', tsx, join(repoRoot, 'packages/proxy/src/call.ts'), 'read_file', JSON.stringify({ path: `note-${index + 1}.md` })], { cwd: ws.cwd, env })));
  const { receipts, publicKey } = log(ws.dataDir);
  assert.deepEqual(receipts.map((item) => item.step), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(receipts.map((item) => item.sessionId)).size, 1);
  assert.deepEqual(verifyChain(receipts, publicKey), { valid: true, brokenAt: null, reason: null });
});
