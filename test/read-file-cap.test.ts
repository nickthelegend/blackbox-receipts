import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Receipt } from '../packages/receipts/src/index.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';

// read_file returns the whole file through the proxy (which hashes it for the receipt), so it is capped
// like write_file and the shell: a huge file, or anything that is not a regular file (a FIFO would block
// the proxy forever), is refused with a readable error and the refusal is still receipted.
test('read_file: refuses files over 2 MB and non-regular files, receipted as errors; a normal file still reads', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-readcap-'));
  writeFileSync(join(cwd, 'small.txt'), 'small\n');
  writeFileSync(join(cwd, 'big.bin'), Buffer.alloc(3 * 1024 * 1024, 0x61));
  execFileSync('mkfifo', [join(cwd, 'pipe')]);
  const dataDir = join(cwd, '.blackbox');
  const env = { RECEIPTS_DIR: dataDir, BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  const client = await connectProxy({ cwd, env });
  const results = [];
  try {
    for (const path of ['big.bin', 'pipe', 'small.txt']) results.push(await client.callTool({ name: 'read_file', arguments: { path } }, undefined, { timeout: 10_000 }));
  } finally { await client.close(); }
  const texts = results.map((result) => (result.content as { text: string }[])[0].text);
  assert.deepEqual(results.map((result) => Boolean(result.isError)), [true, true, false], texts.join('\n'));
  assert.equal(texts[0], 'read_file reads at most 2000000 bytes; big.bin is 3145728 bytes');
  assert.equal(texts[1], 'read_file reads only regular files; pipe is not one');
  assert.equal(texts[2], 'small\n');
  const receipts = readFileSync(join(dataDir, 'session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
  assert.deepEqual(receipts.map((item) => item.outcome), ['error', 'error', 'ok']);
  assert.deepEqual(receipts.map((item) => item.paths), [['big.bin'], ['pipe'], ['small.txt']]);
});
