import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectProxy } from '../packages/proxy/src/client.ts';
import { runScript } from './fixtures/run.ts';

// A proxy killed mid-append (SIGKILL, power loss) or one bad byte leaves a line in session.jsonl that is
// not a JSON record. Every verification path must then FAIL cleanly and say where, instead of crashing
// with a stack trace, and the next proxy must still start (archiving the damaged log as evidence).

async function recorded(calls: number) {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-torn-'));
  writeFileSync(join(cwd, 'notes.md'), '# notes\n');
  const dataDir = join(cwd, '.blackbox');
  const env = { RECEIPTS_DIR: dataDir, BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  const client = await connectProxy({ cwd, env });
  try { for (let index = 0; index < calls; index++) await client.callTool({ name: 'read_file', arguments: { path: 'notes.md' } }); } finally { await client.close(); }
  return { cwd, dataDir, env };
}

/** Keeps the first line whole and cuts the second one off halfway, as a killed append would. */
function tear(file: string) {
  const [first, second] = readFileSync(file, 'utf8').split('\n');
  writeFileSync(file, `${first}\n${second.slice(0, Math.floor(second.length / 2))}`);
}

const noStack = (out: string) => assert.doesNotMatch(out, /SyntaxError|\n\s+at /, `expected a clean failure, got:\n${out}`);

test('torn log line: verify, prove, explain, pack, export and attest-diff FAIL at that line without a stack trace', async () => {
  const ws = await recorded(3);
  tear(join(ws.dataDir, 'session.jsonl'));
  const cli = (...args: string[]) => runScript('packages/proxy/src/cli.ts', ws.cwd, args, ws.env);

  const verify = cli('verify');
  assert.equal(verify.code, 1, verify.out);
  noStack(verify.out);
  const result = JSON.parse(verify.out);
  assert.equal(result.valid, false);
  assert.equal(result.corruptLine, 2);
  assert.match(result.reason, /^session\.jsonl is corrupt at line 2: /);

  for (const command of [['prove'], ['export', join(ws.cwd, 'out')], ['pack', join(ws.cwd, 'pack.json')]]) {
    const run = cli(...command);
    assert.equal(run.code, 1, `${command[0]}: ${run.out}`);
    noStack(run.out);
    assert.match(run.out, /^FAIL no-secrets-read \[policy [^\]]+\]: session\.jsonl is corrupt at line 2: /m, command[0]);
  }
  assert.equal(existsSync(join(ws.cwd, 'out')), false, 'nothing is exported from a corrupt log');
  assert.equal(existsSync(join(ws.cwd, 'pack.json')), false, 'no pack is written from a corrupt log');

  const explain = cli('explain');
  assert.equal(explain.code, 1, explain.out);
  noStack(explain.out);
  assert.match(explain.out, /^FAIL: session\.jsonl is corrupt at line 2: /m);

  const attest = cli('attest-diff', '--base', 'HEAD');
  assert.equal(attest.code, 1, attest.out);
  noStack(attest.out);
  assert.match(attest.out, /^FAIL attest-diff: session\.jsonl is corrupt at line 2: /m);
});

test('torn exported log: verify-export, pack --from and attest-diff --from FAIL naming the export and line', async () => {
  const ws = await recorded(3);
  const cli = (...args: string[]) => runScript('packages/proxy/src/cli.ts', ws.cwd, args, ws.env);
  const out = join(ws.cwd, 'receipts', 'torn');
  assert.equal(cli('export', out).code, 0);
  tear(join(out, 'session.jsonl'));

  const exported = cli('verify-export', 'receipts/torn');
  assert.equal(exported.code, 1, exported.out);
  noStack(exported.out);
  assert.match(exported.out, /^FAIL no-secrets-read \[policy [^\]]+\]: session\.jsonl is corrupt at line 2: .* \[receipts\/torn\]$/m);

  const packed = cli('pack', join(ws.cwd, 'pack.json'), '--from', out);
  assert.equal(packed.code, 1, packed.out);
  noStack(packed.out);
  assert.match(packed.out, /session\.jsonl is corrupt at line 2: /);

  const attest = cli('attest-diff', '--base', 'HEAD', '--from', out);
  assert.equal(attest.code, 1, attest.out);
  noStack(attest.out);
  assert.match(attest.out, /^FAIL attest-diff: session\.jsonl is corrupt at line 2: /m);
});

test('torn log line: the next proxy archives the damaged log as evidence and records a fresh session', async () => {
  const ws = await recorded(2);
  const log = join(ws.dataDir, 'session.jsonl');
  tear(log);
  const damaged = readFileSync(log, 'utf8');
  const client = await connectProxy({ cwd: ws.cwd, env: ws.env });
  try {
    const result = await client.callTool({ name: 'read_file', arguments: { path: 'notes.md' } });
    assert.equal(result.isError, undefined);
  } finally { await client.close(); }
  const kept = readdirSync(join(ws.dataDir, 'sessions')).filter((name) => name.includes('corrupt') && name.endsWith('.jsonl') && !name.includes('witness'));
  assert.equal(kept.length, 1, `expected one archived corrupt log, found ${readdirSync(join(ws.dataDir, 'sessions')).join(', ')}`);
  assert.equal(readFileSync(join(ws.dataDir, 'sessions', kept[0]), 'utf8'), damaged, 'the damaged log is kept byte for byte');
  const verify = runScript('packages/proxy/src/cli.ts', ws.cwd, ['verify'], ws.env);
  assert.equal(verify.code, 0, verify.out);
  assert.equal(JSON.parse(verify.out).receipts, 1);
});

test('torn log line: a one-shot bridge call resuming that session refuses to run the tool and appends nothing', async () => {
  const ws = await recorded(2);
  const log = join(ws.dataDir, 'session.jsonl');
  tear(log);
  const damaged = readFileSync(log, 'utf8');
  const call = runScript('packages/proxy/src/call.ts', ws.cwd, ['write_file', JSON.stringify({ path: 'should-not-exist.txt', content: 'x' })], ws.env);
  assert.notEqual(call.code, 0, call.out);
  assert.match(call.out, /session\.jsonl is corrupt at line 2: .*Not resuming it/);
  assert.equal(existsSync(join(ws.cwd, 'should-not-exist.txt')), false, 'the tool must not run when its receipt cannot be appended');
  assert.equal(readFileSync(log, 'utf8'), damaged, 'the damaged log is left as it was');
});

// A proxy killed after appending a call's witness but before appending its receipt leaves an orphan
// witness line for the next step. The next call records that step again; the prover must use the witness
// that opens the signed argsHash, not the first one with that step number.
test('orphan witness: a witness line left by a kill before its receipt does not break the next proof', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-orphan-'));
  writeFileSync(join(cwd, 'notes.md'), '# notes\n');
  writeFileSync(join(cwd, 'todo.md'), '# todo\n');
  const dataDir = join(cwd, '.blackbox');
  const env = { RECEIPTS_DIR: dataDir, BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  const client = await connectProxy({ cwd, env });
  try {
    await client.callTool({ name: 'read_file', arguments: { path: 'notes.md' } });
    const { sessionId } = JSON.parse(readFileSync(join(dataDir, 'session.jsonl'), 'utf8').trim()) as { sessionId: string };
    appendFileSync(join(dataDir, 'witness.jsonl'), `${JSON.stringify({ sessionId, step: 2, args: { path: 'orphan' }, salt: '00' })}\n`);
    await client.callTool({ name: 'read_file', arguments: { path: 'todo.md' } });
  } finally { await client.close(); }
  const proved = runScript('packages/proxy/src/cli.ts', cwd, ['prove'], env);
  assert.equal(proved.code, 0, proved.out);
  assert.match(proved.out, /^PASS no-secrets-read/);
  assert.match(proved.out, /2\/2|2 steps|2 receipts/);
  const disclosed = runScript('packages/proxy/src/cli.ts', cwd, ['disclose', '2'], env);
  assert.equal(disclosed.code, 0, disclosed.out);
  assert.match(disclosed.out, /todo\.md/);
  assert.doesNotMatch(disclosed.out, /orphan/);
});
