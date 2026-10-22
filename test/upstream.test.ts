import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyChain, type Receipt } from '../packages/receipts/src/index.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';
import { pathsFromArgs, splitCommand } from '../packages/proxy/src/upstream.ts';
import { repoRoot, runScript } from './fixtures/run.ts';

// The proxy in front of a real, separately implemented stdio MCP server (test/fixtures/upstream-server.mjs).
function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-upstream-'));
  mkdirSync(join(cwd, 'keys'));
  writeFileSync(join(cwd, 'note.md'), 'hello from the note\n');
  writeFileSync(join(cwd, 'keys/server.pem'), 'PEM-CANARY\n');
  const dataDir = join(cwd, '.blackbox');
  const log = join(cwd, 'upstream-calls.jsonl');
  const env = { RECEIPTS_DIR: dataDir, BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined, UPSTREAM_LOG: log };
  const upstream = `node "${join(repoRoot, 'test/fixtures/upstream-server.mjs')}"`;
  return { cwd, dataDir, log, env, connect: () => connectProxy({ cwd, env, args: ['--upstream', upstream] }) };
}

const receiptsOf = (dataDir: string) => readFileSync(join(dataDir, 'session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
const upstreamCalls = (log: string) => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

test('upstream: tools/list passes through; calls are forwarded, recorded, and a policy hit never reaches the upstream', async () => {
  const ws = workspace();
  const client = await ws.connect();
  try {
    const listed = await client.listTools();
    // The upstream's tools pass through; the proxy adds its own blackbox_explain after them.
    assert.deepEqual(listed.tools.map((tool) => tool.name), ['echo', 'add', 'read_note', 'fail', 'blackbox_explain']);
    assert.deepEqual(listed.tools[1].inputSchema, { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] });
    const echoed = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    assert.deepEqual(echoed.content, [{ type: 'text', text: 'hi' }]);
    const added = await client.callTool({ name: 'add', arguments: { a: 2, b: 3 } });
    assert.deepEqual(added.structuredContent, { sum: 5 });
    const note = await client.callTool({ name: 'read_note', arguments: { path: 'note.md' } });
    assert.deepEqual(note.content, [{ type: 'text', text: 'hello from the note\n' }]);
    const secret = await client.callTool({ name: 'read_note', arguments: { path: 'keys/server.pem' } });
    assert.equal(secret.isError, true);
    assert.deepEqual(secret.content, [{ type: 'text', text: 'Policy denied (no-secrets-read/v2): read_note touched secret path matching "*.pem"' }]);
    const failed = await client.callTool({ name: 'fail', arguments: {} });
    assert.equal(failed.isError, true);
    assert.match(JSON.stringify(failed.content), /upstream refused/);
    const unknown = await client.callTool({ name: 'nope', arguments: {} });
    assert.equal(unknown.isError, true);
  } finally { await client.close(); }
  assert.deepEqual(upstreamCalls(ws.log).map((call) => call.name), ['echo', 'add', 'read_note', 'fail']);
  const receipts = receiptsOf(ws.dataDir);
  assert.deepEqual(receipts.map((item) => [item.step, item.tool, item.outcome]), [[1, 'echo', 'ok'], [2, 'add', 'ok'], [3, 'read_note', 'ok'], [4, 'read_note', 'denied'], [5, 'fail', 'error'], [6, 'nope', 'error']]);
  assert.deepEqual(receipts[2].paths, ['note.md']);
  assert.deepEqual(receipts[2].permissions, ['upstream:read_note']);
  assert.equal(receipts[3].secretsAccessed, true);
  assert.deepEqual(verifyChain(receipts, readFileSync(join(ws.dataDir, 'public-key.pem'), 'utf8')), { valid: true, brokenAt: null, reason: null });
  const proved = runScript('packages/proxy/src/cli.ts', ws.cwd, ['prove'], ws.env);
  assert.equal(proved.code, 1);
  assert.match(proved.out, /^FAIL no-secrets-read at step 4 \[policy no-secrets-read\/v2 [0-9a-f]{12}\]: read_note touched secret path matching "\*\.pem"/);
});

test('upstream: 20 parallel calls through the proxy keep one chain; export and verify-export PASS', async () => {
  const ws = workspace();
  const client = await ws.connect();
  try {
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => client.callTool({ name: 'echo', arguments: { text: `call ${index}` } })));
    assert.deepEqual(results.map((result) => (result.content as { text: string }[])[0].text).sort(), Array.from({ length: 20 }, (_, index) => `call ${index}`).sort());
  } finally { await client.close(); }
  const receipts = receiptsOf(ws.dataDir);
  assert.deepEqual(receipts.map((item) => item.step), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(upstreamCalls(ws.log).length, 20);
  const exported = runScript('packages/proxy/src/cli.ts', ws.cwd, ['export', 'receipts/run'], ws.env);
  assert.equal(exported.code, 0, exported.out);
  const verified = runScript('packages/proxy/src/cli.ts', ws.cwd, ['verify-export', 'receipts/run'], ws.env);
  assert.equal(verified.code, 0, verified.out);
  assert.match(verified.out, /^PASS no-secrets-read .*: 20 receipts, chain intact, seal matches, proof verified/);
});

test('upstream: a command that cannot start fails loudly', () => {
  const ws = workspace();
  const result = runScript('packages/proxy/src/server.ts', ws.cwd, ['--upstream', 'definitely-not-a-command-blackbox'], ws.env);
  assert.equal(result.code, 1);
  assert.match(result.out, /blackbox-proxy: Could not start the upstream MCP server "definitely-not-a-command-blackbox"/);
});

test('upstream helpers: command splitting and path extraction', () => {
  assert.deepEqual(splitCommand(`node "/a b/server.js" --root '.' -v`), ['node', '/a b/server.js', '--root', '.', '-v']);
  assert.deepEqual(pathsFromArgs({ path: 'a.ts', options: { targetDir: 'out' }, files: ['b.ts', 'c.ts'], query: 'x', uri: 'file:///tmp/d%20e.txt' }), ['a.ts', 'out', 'b.ts', 'c.ts', '/tmp/d e.txt']);
});
