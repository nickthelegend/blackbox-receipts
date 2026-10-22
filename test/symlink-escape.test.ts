import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Receipt } from '../packages/receipts/src/index.ts';
import { safePath } from '../packages/proxy/src/store.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';

// A workspace can ship symlinks (repos do). A write to a file that does not exist yet must not go through a
// symlinked folder (or a dangling symlink) to a place outside the workspace, and the receipt must name the
// real location of what was written.

function workspace() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'blackbox-symlink-')));
  const ws = join(base, 'ws');
  const outside = join(base, 'outside');
  mkdirSync(join(ws, 'real'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, 'existing.txt'), 'OUTSIDE\n');
  writeFileSync(join(ws, 'notes.md'), '# notes\n');
  symlinkSync('../outside', join(ws, 'link'));                       // folder outside the workspace
  symlinkSync('../outside/new.txt', join(ws, 'dangling'));           // file that does not exist yet, outside
  symlinkSync('../outside/missing-dir', join(ws, 'dangling-dir'));   // folder that does not exist yet, outside
  symlinkSync('real', join(ws, 'alias'));                            // folder inside the workspace
  return { ws, outside };
}

function inside<T>(dir: string, work: () => T): T {
  const previous = process.cwd();
  process.chdir(dir);
  try { return work(); } finally { process.chdir(previous); }
}

test('safePath: a new file under a symlinked folder or behind a dangling symlink that leads outside is refused', () => {
  const { ws } = workspace();
  inside(ws, () => {
    for (const path of ['link/escape.txt', 'link/sub/deeper.txt', 'link/existing.txt', 'dangling', 'dangling-dir/x.txt', '../outside/x.txt']) {
      assert.throws(() => safePath(path), /Path must stay inside the current working directory/, path);
    }
    // Inside the workspace, through a symlink: allowed, and named by its real location.
    assert.deepEqual(safePath('alias/new.txt'), { path: join(ws, 'real/new.txt'), relativePath: 'real/new.txt' });
    assert.deepEqual(safePath('new/dir/file.txt'), { path: join(ws, 'new/dir/file.txt'), relativePath: 'new/dir/file.txt' });
    assert.deepEqual(safePath('notes.md'), { path: join(ws, 'notes.md'), relativePath: 'notes.md' });
  });
});

test('write_file (real proxy): a write through a symlinked folder to outside the workspace is refused and nothing lands there', async () => {
  const { ws, outside } = workspace();
  const dataDir = join(ws, '.blackbox');
  const env = { RECEIPTS_DIR: dataDir, BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  const client = await connectProxy({ cwd: ws, env });
  const results = [];
  try {
    results.push(await client.callTool({ name: 'write_file', arguments: { path: 'link/escape.txt', content: 'ESCAPED\n' } }));
    results.push(await client.callTool({ name: 'write_file', arguments: { path: 'dangling', content: 'ESCAPED\n' } }));
    results.push(await client.callTool({ name: 'write_file', arguments: { path: 'alias/kept.txt', content: 'inside\n' } }));
  } finally { await client.close(); }
  const texts = results.map((result) => (result.content as { text: string }[])[0].text);
  assert.deepEqual(results.map((result) => Boolean(result.isError)), [true, true, false], texts.join('\n'));
  assert.match(texts[0], /Path must stay inside the current working directory/);
  assert.deepEqual(readdirSync(outside).sort(), ['existing.txt'], 'nothing may be written outside the workspace');
  assert.equal(readFileSync(join(ws, 'real/kept.txt'), 'utf8'), 'inside\n');
  const receipts = readFileSync(join(dataDir, 'session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
  assert.deepEqual(receipts.map((receipt) => receipt.outcome), ['error', 'error', 'ok']);
  // The successful write is signed under its real path, so attest-diff checks the file that really changed.
  assert.deepEqual(receipts[2].paths, ['real/kept.txt']);
  assert.deepEqual(receipts[2].artifacts?.map((artifact) => artifact.path), ['real/kept.txt']);
  assert.equal(existsSync(join(outside, 'escape.txt')), false);
});
