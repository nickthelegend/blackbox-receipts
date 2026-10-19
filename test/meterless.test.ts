import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeterlessClient, MeterlessConfigError, meterlessConfigFromEnv, normalizeMeterlessUrl } from '../packages/meterless/src/index.ts';

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
