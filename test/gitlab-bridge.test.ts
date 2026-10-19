import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Drives the real one-shot MCP bridge (packages/proxy/src/call.ts) the way a GitLab Duo flow does via
// run_command: one process per tool call, each starting the proxy over stdio and appending a receipt.
const repoRoot = resolve(import.meta.dirname, '..');
const tsx = import.meta.resolve('tsx');

function run(script: string, cwd: string, dataDir: string, args: string[], env: Record<string, string> = {}): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, ['--conditions=source', '--import', tsx, join(repoRoot, script), ...args], { cwd, env: { ...process.env, RECEIPTS_DIR: dataDir, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { code: failure.status, out: failure.stdout + failure.stderr };
  }
}

function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-flow-'));
  writeFileSync(join(cwd, 'notes.md'), '# notes\nship it\n');
  writeFileSync(join(cwd, '.env'), 'API_TOKEN=do-not-read\n');
  const dataDir = join(cwd, '.blackbox');
  return {
    cwd,
    call: (...args: string[]) => run('packages/proxy/src/call.ts', cwd, dataDir, args),
    cli: (args: string[], env?: Record<string, string>) => run('packages/proxy/src/cli.ts', cwd, dataDir, args, env),
  };
}

test('bridge: separate processes extend one signed session; export and verify-export PASS', () => {
  const ws = workspace();
  const read = ws.call('--new-session', 'read_file', '{"path":"notes.md"}');
  assert.equal(read.code, 0, read.out);
  assert.match(read.out, /ship it/);
  assert.equal(ws.call('shell', '{"command":"ls"}').code, 0);
  assert.equal(ws.call('shell', '{"command":"pwd"}').code, 0);
  const exported = ws.cli(['export']);
  assert.equal(exported.code, 0, exported.out);
  assert.match(exported.out, /^PASS no-secrets-read: 3\/3 receipts/);
  const sessionDir = exported.out.match(/exported 3 receipts to (\S+)/)![1];
  const receipts = readFileSync(join(ws.cwd, sessionDir, 'session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(receipts.map((item) => item.step), [1, 2, 3]);
  assert.equal(new Set(receipts.map((item) => item.sessionId)).size, 1);
  const exportedFiles = ['session.jsonl', 'public-key.pem', 'result.txt', 'proof-no-secrets.json'];
  for (const file of exportedFiles) assert.ok(readFileSync(join(ws.cwd, sessionDir, file)));
  assert.throws(() => readFileSync(join(ws.cwd, sessionDir, 'signing-key.pem')));
  assert.throws(() => readFileSync(join(ws.cwd, sessionDir, 'witness.jsonl')));
  const verified = ws.cli(['verify-export']);
  assert.equal(verified.code, 0, verified.out);
  assert.match(verified.out, /^PASS no-secrets-read: 3 receipts, chain intact, proof verified/);
});

test('bridge: a secret read is denied, recorded, and fails export and verify-export at that step', () => {
  const ws = workspace();
  ws.call('--new-session', 'read_file', '{"path":"notes.md"}');
  const denied = ws.call('read_file', '{"path":".env"}');
  assert.equal(denied.code, 1);
  assert.match(denied.out, /DENIED or FAILED \(receipt recorded\): Policy denied access to secret path/);
  assert.doesNotMatch(denied.out, /do-not-read/);
  const exported = ws.cli(['export']);
  assert.equal(exported.code, 1);
  assert.match(exported.out, /^FAIL no-secrets-read at step 2: read_file touched secret path matching "\.env\*"/);
  const verified = ws.cli(['verify-export']);
  assert.equal(verified.code, 1);
  assert.match(verified.out, /^FAIL no-secrets-read: Export has no property proof\. Prover reported: FAIL no-secrets-read at step 2/);
});

test('verify-export: FAIL on an edited exported receipt and on an unpinned key', () => {
  const ws = workspace();
  ws.call('--new-session', 'shell', '{"command":"pwd"}');
  ws.call('read_file', '{"path":"notes.md"}');
  const exported = ws.cli(['export', 'receipts/run']);
  assert.equal(exported.code, 0, exported.out);
  const pinnedOther = ws.cli(['verify-export', 'receipts/run'], { BLACKBOX_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nnot-this-key\n-----END PUBLIC KEY-----' });
  assert.equal(pinnedOther.code, 1);
  assert.match(pinnedOther.out, /does not match the pinned BLACKBOX_PUBLIC_KEY/);
  const file = join(ws.cwd, 'receipts/run/session.jsonl');
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  const second = JSON.parse(lines[1]);
  second.paths = ['innocent.md'];
  lines[1] = JSON.stringify(second);
  writeFileSync(file, `${lines.join('\n')}\n`);
  const tampered = ws.cli(['verify-export', 'receipts/run']);
  assert.equal(tampered.code, 1);
  assert.match(tampered.out, /^FAIL no-secrets-read at step 2: Chain verification failed: Receipt contents were changed/);
});

test('verify-export: FAIL when nothing was exported', () => {
  const result = workspace().cli(['verify-export']);
  assert.equal(result.code, 1);
  assert.match(result.out, /no exported sessions found/);
});
