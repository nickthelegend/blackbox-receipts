import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyChain, type Receipt } from '../packages/receipts/src/index.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';

function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-lifecycle-'));
  writeFileSync(join(cwd, 'notes.md'), '# notes\n');
  const dataDir = join(cwd, '.blackbox');
  return { cwd, dataDir, env: { RECEIPTS_DIR: dataDir, RECEIPTS_RESUME: undefined } };
}

const readLog = (file: string) => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));

async function session(ws: ReturnType<typeof workspace>, calls: number) {
  const client = await connectProxy({ cwd: ws.cwd, env: ws.env });
  try { for (let index = 0; index < calls; index++) await client.callTool({ name: 'read_file', arguments: { path: 'notes.md' } }); } finally { await client.close(); }
}

test('restarting the proxy archives the previous session with its raw arguments instead of wiping it', async () => {
  const ws = workspace();
  await session(ws, 2);
  const first = readLog(join(ws.dataDir, 'session.jsonl')) as Receipt[];
  await session(ws, 1);
  const current = readLog(join(ws.dataDir, 'session.jsonl')) as Receipt[];
  assert.equal(current.length, 1);
  assert.notEqual(current[0].sessionId, first[0].sessionId);
  const archived = readLog(join(ws.dataDir, 'sessions', `${first[0].sessionId}.jsonl`)) as Receipt[];
  assert.deepEqual(archived, first);
  assert.deepEqual(verifyChain(archived, readFileSync(join(ws.dataDir, 'public-key.pem'), 'utf8')), { valid: true, brokenAt: null, reason: null });
  const witness = readLog(join(ws.dataDir, 'sessions', `${first[0].sessionId}.witness.jsonl`));
  assert.deepEqual(witness.map((item) => [item.step, item.args.path]), [[1, 'notes.md'], [2, 'notes.md']]);
  await session(ws, 0);
  assert.deepEqual(readdirSync(join(ws.dataDir, 'sessions')).filter((name) => name.endsWith('.jsonl') && !name.includes('witness')).length, 2);
});
