import test from 'node:test';
import assert from 'node:assert/strict';
import { ZetarisClient, ZetarisConfigError, zetarisConfigFromEnv } from '../packages/zetaris/src/index.ts';

test('zetaris: missing keys throw a clear config error', () => {
  assert.throws(() => zetarisConfigFromEnv({}), (err: unknown) =>
    err instanceof ZetarisConfigError && /ZETARIS_API_KEY, ZETARIS_ORG_ID/.test(err.message));
  assert.throws(() => zetarisConfigFromEnv({ ZETARIS_API_KEY: 'k' }), /missing ZETARIS_ORG_ID/);
  assert.throws(() => zetarisConfigFromEnv({ ZETARIS_API_KEY: 'k', ZETARIS_ORG_ID: 'acme' }), /must be an integer/);
});

test('zetaris: base URL defaults to the SaaS host and drops trailing slashes', () => {
  assert.equal(zetarisConfigFromEnv({ ZETARIS_API_KEY: 'k', ZETARIS_ORG_ID: '42' }).baseUrl, 'https://api.saas.enterprise.zetaris.com');
  assert.equal(zetarisConfigFromEnv({ ZETARIS_API_KEY: 'k', ZETARIS_ORG_ID: '42', ZETARIS_BASE_URL: 'https://z.example/' }).baseUrl, 'https://z.example');
});

const live = !!(process.env.ZETARIS_API_KEY && process.env.ZETARIS_ORG_ID);
if (!live) {
  console.warn('\n⚠️  SKIPPING LIVE ZETARIS TESTS: ZETARIS_API_KEY and ZETARIS_ORG_ID are not set. Nothing was called against Zetaris.\n');
}

test('zetaris live: lists data marts from the real API', { skip: live ? false : 'ZETARIS_API_KEY / ZETARIS_ORG_ID not set' }, async () => {
  const marts = await new ZetarisClient().listDataMarts();
  assert.ok(Array.isArray(marts));
  for (const m of marts) assert.equal(typeof m.dataMartId, 'number');
});

test('zetaris live: runs a SQL query and closes it', { skip: live && process.env.ZETARIS_TEST_SQL ? false : 'needs Zetaris keys and ZETARIS_TEST_SQL' }, async () => {
  const { records, totalCount } = await new ZetarisClient().querySql(process.env.ZETARIS_TEST_SQL!, { pageLimit: 10, maxPages: 1 });
  assert.ok(Array.isArray(records));
  assert.equal(typeof totalCount, 'number');
});
