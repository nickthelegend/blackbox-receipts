import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSecretPolicy, evaluateStep, type Receipt, type Witness } from '../packages/receipts/src/index.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';
import { runScript } from './fixtures/run.ts';

// The proxy's guard and the prover use the same policy evaluation, so whatever the prover would flag
// is refused before it runs, and recorded as denied.
test('guard: *.pem and *.key reads are denied before running, recorded as denied, and prove fails at that step', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-guard-'));
  mkdirSync(join(cwd, 'deploy'));
  mkdirSync(join(cwd, 'config'));
  writeFileSync(join(cwd, 'notes.md'), '# notes\n');
  writeFileSync(join(cwd, 'deploy/server.pem'), 'PEM-CANARY\n');
  writeFileSync(join(cwd, 'config/app.key'), 'KEY-CANARY\n');
  const dataDir = join(cwd, '.blackbox');
  const client = await connectProxy({ cwd, env: { RECEIPTS_DIR: dataDir, RECEIPTS_RESUME: undefined } });
  const results = [];
  try {
    results.push(await client.callTool({ name: 'read_file', arguments: { path: 'notes.md' } }));
    results.push(await client.callTool({ name: 'read_file', arguments: { path: 'deploy/server.pem' } }));
    results.push(await client.callTool({ name: 'shell', arguments: { command: 'cat config/app.key' } }));
    results.push(await client.callTool({ name: 'shell', arguments: { command: 'ls deploy' } }));
  } finally { await client.close(); }
  const texts = results.map((result) => (result.content as { text: string }[])[0].text);
  assert.deepEqual(results.map((result) => Boolean(result.isError)), [false, true, true, false]);
  assert.equal(texts[1], 'Policy denied (no-secrets-read/v1): read_file touched secret path matching "*.pem"');
  assert.equal(texts[2], 'Policy denied (no-secrets-read/v1): shell touched secret path matching "*.key"');
  assert.ok(!texts.join('').includes('CANARY'));
  const receipts = readFileSync(join(dataDir, 'session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
  const witnesses = readFileSync(join(dataDir, 'witness.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Witness);
  assert.deepEqual(receipts.map((item) => item.outcome), ['ok', 'denied', 'denied', 'ok']);
  assert.deepEqual(receipts.map((item) => item.secretsAccessed), [false, true, true, false]);
  // Guard and prover agree step by step on the policy rule itself, not just the denial flag.
  const verdicts = receipts.map((receipt, index) => evaluateStep({ ...receipt, secretsAccessed: false }, witnesses[index].args, defaultSecretPolicy));
  assert.deepEqual(verdicts, [null, 'read_file touched secret path matching "*.pem"', 'shell touched secret path matching "*.key"', null]);
  const proved = runScript('packages/proxy/src/cli.ts', cwd, ['prove'], { RECEIPTS_DIR: dataDir });
  assert.equal(proved.code, 1);
  assert.match(proved.out, /^FAIL no-secrets-read at step 2 \[policy no-secrets-read\/v1 [0-9a-f]{12}\]: read_file touched secret path matching "\*\.pem"/);
});
