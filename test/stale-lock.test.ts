import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// A holder that crashed leaves session.lock behind with its dead pid. Several waiters then see that dead
// pid at once; reclaiming it must be atomic, or one waiter deletes the fresh lock another just took and
// both append with the same step and previousHash (a forked chain).
const repoRoot = resolve(import.meta.dirname, '..');
const tsx = import.meta.resolve('tsx');

test('stale lock: waiters racing to reclaim a dead holder\'s lock never hold it at the same time', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'blackbox-stalelock-'));
  mkdirSync(dataDir, { recursive: true });
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  writeFileSync(join(dataDir, 'session.lock'), `${dead.stdout}\n`);
  const goFile = join(dataDir, 'go');
  const outFile = join(dataDir, 'trace.txt');
  writeFileSync(outFile, '');
  const workers = 8;
  const env = { ...process.env, RECEIPTS_DIR: dataDir, BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  const exits = Array.from({ length: workers }, () => new Promise<number | null>((done) => {
    const child = spawn(process.execPath, ['--conditions=source', '--import', tsx, join(repoRoot, 'test/fixtures/lock-worker.ts'), goFile, outFile], { cwd: dataDir, env, stdio: 'ignore' });
    child.on('exit', done);
  }));
  while (readFileSync(outFile, 'utf8').split('\n').filter((line) => line.startsWith('ready')).length < workers) await new Promise((done) => setTimeout(done, 20));
  writeFileSync(goFile, '');
  assert.deepEqual(await Promise.all(exits), Array(workers).fill(0));
  const events = readFileSync(outFile, 'utf8').split('\n').filter((line) => /^(enter|exit) /.test(line));
  assert.equal(events.length, workers * 2);
  // Strictly alternating enter/exit of the same process: no two holders at once.
  for (let index = 0; index < events.length; index += 2) {
    const [enter, exit] = [events[index].split(' '), events[index + 1].split(' ')];
    assert.deepEqual([enter[0], exit[0], exit[1]], ['enter', 'exit', enter[1]], `overlapping holders:\n${events.join('\n')}`);
  }
  assert.equal(existsSync(join(dataDir, 'session.lock')), false);
});
