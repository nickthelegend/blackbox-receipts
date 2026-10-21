import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeterlessClient, MeterlessConfigError, meterlessConfigFromEnv, normalizeMeterlessUrl } from '../packages/meterless/src/index.ts';
import { checkCitations } from '../packages/proxy/src/narrate.ts';
import type { Explanation } from '../packages/proxy/src/explain.ts';
import { buildSession, cleanCalls, writeSessionDir } from './fixtures/session.ts';
import { runScript } from './fixtures/run.ts';

// `explain --model meterless`: the explainer's facts rewritten by the local Meterless Runtime.
const METERLESS_ENV = ['METERLESS_TOKEN', 'METERLESS_STATE_DIR', 'METERLESS_BASE_URL', 'BLACKBOX_EXPLAIN_MODEL'];
function explainWith(env: Record<string, string>, ...args: string[]) {
  const dir = writeSessionDir(buildSession(cleanCalls));
  const cleared = Object.fromEntries(METERLESS_ENV.map((name) => [name, undefined]));
  return runScript('packages/proxy/src/cli.ts', dir, ['explain', '--model', 'meterless', ...args], { ...cleared, RECEIPTS_DIR: dir, BLACKBOX_KEY_DIR: dir, ...env });
}

test('meterless: missing token throws a clear config error', () => {
  assert.throws(() => meterlessConfigFromEnv({}), (err: unknown) =>
    err instanceof MeterlessConfigError && /METERLESS_TOKEN/.test(err.message));
  assert.throws(() => meterlessConfigFromEnv({ METERLESS_STATE_DIR: join(tmpdir(), 'no-such-meterless-dir') }), /could not read/);
  assert.throws(() => meterlessConfigFromEnv({ METERLESS_TOKEN: 'rt-local' }), /placeholder/);
});

test('meterless: token is read from <stateDir>/proxy-token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meterless-'));
  writeFileSync(join(dir, 'proxy-token'), 'abc123\n');
  assert.deepEqual(meterlessConfigFromEnv({ METERLESS_STATE_DIR: dir }), { token: 'abc123', baseUrl: 'http://127.0.0.1:8088/v1' });
});

test('meterless: pasted URLs normalise to <host>/v1', () => {
  for (const input of ['127.0.0.1:8088', 'http://127.0.0.1:8088/v1', 'http://127.0.0.1:8088/v1/', 'http://127.0.0.1:8088/v1/chat/completions', 'http://127.0.0.1:8088/v1/models', 'http://127.0.0.1:8088/healthz', 'http://127.0.0.1:8088/v1/v1']) {
    assert.equal(normalizeMeterlessUrl(input), 'http://127.0.0.1:8088/v1', input);
  }
});

test('explain --model meterless: no token is "Setup required" (exit 2), not a narrative', () => {
  const result = explainWith({});
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /^Setup required: Meterless not configured: set METERLESS_TOKEN, or METERLESS_STATE_DIR/m);
  assert.doesNotMatch(result.out, /## Narrative/);
});

test('explain --model meterless: a runtime that is not running is "Setup required" (exit 2), naming the URL', () => {
  // Port 9 (discard) on loopback: a real connection attempt that nothing answers.
  const result = explainWith({ METERLESS_TOKEN: 'any-token', METERLESS_BASE_URL: 'http://127.0.0.1:9' });
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /Setup required: the Meterless Runtime is not reachable at http:\/\/127\.0\.0\.1:9\/v1/);
  assert.equal(explainWith({}, '--routing', 'x').code, 2);
});

test('narrative citations: steps the model names are checked against the session', () => {
  const model = { steps: [1, 2, 3].map((step) => ({ step })) } as unknown as Explanation;
  assert.deepEqual(checkCitations('It listed files (step 1), was refused at step 3 and read steps 2 and 7.', model), { cited: [1, 2, 3, 7], unknownSteps: [7] });
  assert.deepEqual(checkCitations('Nothing cited.', model), { cited: [], unknownSteps: [] });
});

const live = !!(process.env.METERLESS_TOKEN || process.env.METERLESS_STATE_DIR);
if (!live) {
  console.warn('\n⚠️  SKIPPING LIVE METERLESS TESTS: METERLESS_TOKEN or METERLESS_STATE_DIR is not set. Nothing was called against a Meterless Runtime.\n');
}

test('meterless live: runtime is online and answers meterless/auto', { skip: live ? false : 'METERLESS_TOKEN / METERLESS_STATE_DIR not set' }, async () => {
  const client = new MeterlessClient();
  assert.equal(await client.status(), 'online', `Meterless Runtime at ${client.config.baseUrl} is not online`);
  assert.ok((await client.listModels()).some((id) => id.startsWith('meterless/')));
  const reply = await client.chat([{ role: 'user', content: 'Reply with the single word: ok' }]);
  assert.equal(typeof reply, 'string');
});

test('meterless live: a wrong token reads as unauthorized, not offline', { skip: live ? false : 'METERLESS_TOKEN / METERLESS_STATE_DIR not set' }, async () => {
  const { baseUrl } = meterlessConfigFromEnv();
  assert.equal(await new MeterlessClient({ baseUrl, token: 'definitely-wrong-token' }).status(), 'unauthorized');
});

test('meterless live: explain --model meterless appends a narrative and checks its citations', { skip: live ? false : 'METERLESS_TOKEN / METERLESS_STATE_DIR not set' }, () => {
  const dir = writeSessionDir(buildSession(cleanCalls));
  const result = runScript('packages/proxy/src/cli.ts', dir, ['explain', '--model', 'meterless', '--json'], { RECEIPTS_DIR: dir, BLACKBOX_KEY_DIR: dir });
  assert.equal(result.code, 0, result.out);
  const model = JSON.parse(result.out) as Explanation & { narrative: { provider: string; text: string; cited: number[]; unknownSteps: number[] } };
  assert.equal(model.narrative.provider, 'meterless');
  assert.ok(model.narrative.text.length > 0);
  assert.deepEqual(model.narrative.unknownSteps, model.narrative.cited.filter((step) => !model.steps.some((item) => item.step === step)));
});
