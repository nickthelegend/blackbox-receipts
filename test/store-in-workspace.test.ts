import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Receipt } from '../packages/receipts/src/index.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';
import { runScript } from './fixtures/run.ts';

// A receipt store inside the workspace under any name (RECEIPTS_DIR=<cwd>/store) is as off-limits to the
// agent as .blackbox/: reading the witness would leak the raw arguments, and rewriting session.jsonl would
// let the agent drop the receipt of a denied call and keep chaining from the shortened log.
test('guard: a RECEIPTS_DIR inside the workspace is denied by its real location, whatever it is named', async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'blackbox-storews-')));
  writeFileSync(join(cwd, 'notes.md'), '# notes\n');
  writeFileSync(join(cwd, '.env'), 'TOKEN=do-not-read\n');
  symlinkSync('store', join(cwd, 'alias'));
  const env = { RECEIPTS_DIR: join(cwd, 'store'), BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  const client = await connectProxy({ cwd, env });
  const results = [];
  try {
    results.push(await client.callTool({ name: 'read_file', arguments: { path: 'notes.md' } }));
    results.push(await client.callTool({ name: 'read_file', arguments: { path: '.env' } }));
    results.push(await client.callTool({ name: 'read_file', arguments: { path: 'store/witness.jsonl' } }));
    results.push(await client.callTool({ name: 'read_file', arguments: { path: 'store/session.jsonl' } }));
    results.push(await client.callTool({ name: 'write_file', arguments: { path: 'store/session.jsonl', content: '' } }));
    results.push(await client.callTool({ name: 'shell', arguments: { command: 'cat alias/witness.jsonl' } }));
    results.push(await client.callTool({ name: 'shell', arguments: { command: 'ls store' } }));
  } finally { await client.close(); }
  const texts = results.map((result) => (result.content as { text: string }[])[0].text);
  assert.deepEqual(results.map((result) => Boolean(result.isError)), [false, true, true, true, true, true, true], texts.join('\n'));
  for (const text of texts.slice(2)) assert.match(text, /^Policy denied \(no-secrets-read\/v2\): \w+ touched the receipt store$/);
  assert.ok(!texts.join('').includes('do-not-read'));
  const receipts = readFileSync(join(cwd, 'store/session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
  assert.deepEqual(receipts.map((item) => item.step), [1, 2, 3, 4, 5, 6, 7], 'the log was not shortened');
  assert.deepEqual(receipts.map((item) => item.outcome), ['ok', 'denied', 'denied', 'denied', 'denied', 'denied', 'denied']);
  assert.deepEqual(receipts.slice(2).map((item) => item.secretsAccessed), [true, true, true, true, true]);
  const proved = runScript('packages/proxy/src/cli.ts', cwd, ['prove'], env);
  assert.equal(proved.code, 1, proved.out);
  assert.match(proved.out, /^FAIL no-secrets-read at step 2 /);
  const verified = runScript('packages/proxy/src/cli.ts', cwd, ['verify'], env);
  assert.equal(verified.code, 0, verified.out);
});
