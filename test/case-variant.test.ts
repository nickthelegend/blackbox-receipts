import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSecretPolicy, evaluateCall, type Receipt } from '../packages/receipts/src/index.ts';
import { isSecretPath } from '../packages/proxy/src/store.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';
import { runScript } from './fixtures/run.ts';

// macOS and Windows disks are case-insensitive by default, so `.ENV` opens `.env`. The policy has to
// match the way the disk does, or a case variant reads a secret and the prover still passes.
test('policy: case variants of secret paths match, on the prover side too (upstream paths are never resolved)', () => {
  for (const path of ['.ENV', '.Env.local', '.GIT/config', '.NPMRC', 'Secrets/token.txt', '.Blackbox/witness.jsonl', 'deploy/SERVER.PEM', 'Credentials.JSON']) {
    assert.notEqual(evaluateCall('read_file', [path], { path }, defaultSecretPolicy), null, path);
  }
  assert.equal(evaluateCall('read_file', ['README.md'], { path: 'README.md' }, defaultSecretPolicy), null);
  for (const path of ['.ENV', '.Env.local', 'SECRETS/a', '.Blackbox/witness.jsonl', '.SSH/id_rsa', 'keys/Signing-Key.pem']) assert.equal(isSecretPath(path), true, path);
  assert.equal(isSecretPath('docs/environment.md'), false);
});

test('guard: .ENV, cat .Env, .GIT/config and .NPMRC are denied before running, and prove fails at step 1', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-case-'));
  writeFileSync(join(cwd, '.env'), 'ENV-CANARY=1\n');
  mkdirSync(join(cwd, '.git'));
  writeFileSync(join(cwd, '.git/config'), '[credential]\n\thelper = GIT-CANARY\n');
  writeFileSync(join(cwd, '.npmrc'), '//registry.npmjs.org/:_authToken=NPM-CANARY\n');
  const dataDir = join(cwd, 'store');
  const env = { RECEIPTS_DIR: dataDir, BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  const client = await connectProxy({ cwd, env });
  const results = [];
  try {
    results.push(await client.callTool({ name: 'read_file', arguments: { path: '.ENV' } }));
    results.push(await client.callTool({ name: 'shell', arguments: { command: 'cat .Env' } }));
    results.push(await client.callTool({ name: 'read_file', arguments: { path: '.GIT/config' } }));
    results.push(await client.callTool({ name: 'read_file', arguments: { path: '.NPMRC' } }));
  } finally { await client.close(); }
  const texts = results.map((result) => (result.content as { text: string }[])[0].text);
  assert.deepEqual(results.map((result) => Boolean(result.isError)), [true, true, true, true]);
  for (const text of texts) assert.match(text, /^Policy denied \(no-secrets-read\/v2\)/);
  assert.ok(!texts.join('').includes('CANARY'));
  const receipts = readFileSync(join(dataDir, 'session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
  assert.deepEqual(receipts.map((item) => item.outcome), ['denied', 'denied', 'denied', 'denied']);
  assert.deepEqual(receipts.map((item) => item.secretsAccessed), [true, true, true, true]);
  const proved = runScript('packages/proxy/src/cli.ts', cwd, ['prove'], env);
  assert.equal(proved.code, 1);
  assert.match(proved.out, /^FAIL no-secrets-read at step 1 /);
});
