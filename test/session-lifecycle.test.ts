import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyChain, type Receipt } from '../packages/receipts/src/index.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';
import { runScript } from './fixtures/run.ts';

function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-lifecycle-'));
  writeFileSync(join(cwd, 'notes.md'), '# notes\n');
  const dataDir = join(cwd, '.blackbox');
  return { cwd, dataDir, env: { RECEIPTS_DIR: dataDir, BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined } };
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

const cli = (ws: ReturnType<typeof workspace>, ...args: string[]) => runScript('packages/proxy/src/cli.ts', ws.cwd, args, ws.env);
const dropLastLine = (file: string) => { const lines = readFileSync(file, 'utf8').trim().split('\n'); writeFileSync(file, `${lines.slice(0, -1).join('\n')}\n`); };

test('proxy shutdown seals the log; cutting the last receipt off is caught by the seal', async () => {
  const ws = workspace();
  await session(ws, 3);
  const seal = JSON.parse(readFileSync(join(ws.dataDir, 'seal.json'), 'utf8'));
  assert.equal(seal.count, 3);
  assert.equal(cli(ws, 'prove').code, 0);
  dropLastLine(join(ws.dataDir, 'session.jsonl'));
  const proved = cli(ws, 'prove');
  assert.equal(proved.code, 1);
  assert.match(proved.out, /^FAIL no-secrets-read.*: Seal says 3 receipts ending at [0-9a-f]{12}, but the log has 2: receipts were removed from the end/);
  const verified = cli(ws, 'verify');
  assert.equal(verified.code, 1);
  assert.match(verified.out, /"seal": "BROKEN"/);
});

test('verify-export: dropping the last exported receipt fails on the seal; a missing seal fails too', async () => {
  const ws = workspace();
  await session(ws, 3);
  const exported = cli(ws, 'export', 'receipts/run');
  assert.equal(exported.code, 0, exported.out);
  assert.match(cli(ws, 'verify-export', 'receipts/run').out, /^PASS .*3 receipts, chain intact, seal matches/);
  dropLastLine(join(ws.cwd, 'receipts/run/session.jsonl'));
  const truncated = cli(ws, 'verify-export', 'receipts/run');
  assert.equal(truncated.code, 1);
  assert.match(truncated.out, /^FAIL no-secrets-read.*: Seal says 3 receipts ending at [0-9a-f]{12}, but the log has 2: receipts were removed from the end/);
  rmSync(join(ws.cwd, 'receipts/run/seal.json'));
  const unsealed = cli(ws, 'verify-export', 'receipts/run');
  assert.equal(unsealed.code, 1);
  assert.match(unsealed.out, /Seal is missing/);
});

test('signing key lives in BLACKBOX_KEY_DIR, not the workspace; the public key is exported next to the receipts', async () => {
  const ws = workspace();
  await session(ws, 1);
  const files = readdirSync(ws.dataDir);
  assert.ok(files.includes('public-key.pem'));
  assert.ok(!files.some((name) => name.includes('signing-key')));
  assert.ok(readdirSync(ws.env.BLACKBOX_KEY_DIR).includes('signing-key.pem'));
  const printed = cli(ws, 'public-key');
  assert.equal(printed.code, 0);
  assert.equal(printed.out, readFileSync(join(ws.dataDir, 'public-key.pem'), 'utf8'));
  assert.equal(cli(ws, 'export', 'receipts/run').code, 0);
  assert.ok(!readdirSync(join(ws.cwd, 'receipts/run')).some((name) => name.includes('signing-key')));
});
