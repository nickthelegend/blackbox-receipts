import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Receipt } from '../packages/receipts/src/index.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';

// The git tool is read-only: an option smuggled in as the revision (git show --output=<file>) must not
// run, because git would write that file, even outside the workspace.
test('git: show refuses options as the revision and writes no file; a plain rev:path still works', async () => {
  const outer = mkdtempSync(join(tmpdir(), 'blackbox-gitopt-'));
  const cwd = join(outer, 'repo');
  mkdirSync(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  git('init', '-q');
  writeFileSync(join(cwd, 'README.md'), '# readme\n');
  git('add', 'README.md');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init');
  const dataDir = join(outer, 'store');
  const env = { RECEIPTS_DIR: dataDir, BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  const client = await connectProxy({ cwd, env });
  const results = [];
  try {
    results.push(await client.callTool({ name: 'git', arguments: { action: 'show', args: ['--output=../escaped:README.md'] } }));
    results.push(await client.callTool({ name: 'git', arguments: { action: 'show', args: ['--output=inside:README.md'] } }));
    results.push(await client.callTool({ name: 'git', arguments: { action: 'show', args: ['HEAD --output=x:README.md'] } }));
    results.push(await client.callTool({ name: 'git', arguments: { action: 'show', args: ['HEAD:README.md'] } }));
  } finally { await client.close(); }
  assert.equal(existsSync(join(outer, 'escaped:README.md')), false);
  assert.equal(existsSync(join(outer, 'escaped')), false);
  assert.equal(existsSync(join(cwd, 'inside')), false);
  assert.equal(existsSync(join(cwd, 'inside:README.md')), false);
  assert.deepEqual(results.map((result) => Boolean(result.isError)), [true, true, true, false]);
  assert.equal((results[3].content as { text: string }[])[0].text, '# readme\n');
  const receipts = readFileSync(join(dataDir, 'session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
  assert.deepEqual(receipts.map((item) => item.outcome), ['error', 'error', 'error', 'ok']);
});

// git resolves `rev:path` from the repository root, but the proxy checks paths against its working
// directory. Run from a subdirectory, `HEAD:outside.txt` must read sub/outside.txt (what was checked and
// signed), never the root file of the same name.
test('git: show from a subdirectory reads the path relative to the proxy cwd, the one its receipt names', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'blackbox-gitsub-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  mkdirSync(join(repo, 'sub'));
  writeFileSync(join(repo, 'outside.txt'), 'ROOTFILE\n');
  writeFileSync(join(repo, 'sub/outside.txt'), 'SUBFILE\n');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init');
  const dataDir = mkdtempSync(join(tmpdir(), 'blackbox-gitsub-store-'));
  const env = { RECEIPTS_DIR: dataDir, BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  const client = await connectProxy({ cwd: join(repo, 'sub'), env });
  let result;
  try { result = await client.callTool({ name: 'git', arguments: { action: 'show', args: ['HEAD:outside.txt'] } }); } finally { await client.close(); }
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.equal((result.content as { text: string }[])[0].text, 'SUBFILE\n');
  const [receipt] = readFileSync(join(dataDir, 'session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
  assert.deepEqual(receipt.paths, ['outside.txt']);
});
