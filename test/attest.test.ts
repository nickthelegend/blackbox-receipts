import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicKeyFromPem, verifyDigestSignature, type Receipt } from '../packages/verify/src/index.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';
import { attestationDigest, type DiffAttestation } from '../packages/proxy/src/attest.ts';
import { runScript } from './fixtures/run.ts';

// Receipt-gated merge: a real git repo, an agent writing through the proxy's write_file, then
// attest-diff over the change set.
async function agentRepo() {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-attest-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(cwd, 'README.md'), '# repo\n');
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  const env = { RECEIPTS_DIR: join(cwd, '.blackbox'), BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  const client = await connectProxy({ cwd, env });
  try {
    for (const [path, content] of [['src/a.ts', 'export const a = 2;\n'], ['src/new.ts', 'export const b = 3;\n']]) {
      const result = await client.callTool({ name: 'write_file', arguments: { path, content } });
      assert.equal(result.isError, undefined, JSON.stringify(result.content));
    }
    const denied = await client.callTool({ name: 'write_file', arguments: { path: '.env', content: 'TOKEN=x\n' } });
    assert.equal(denied.isError, true);
  } finally { await client.close(); }
  const cli = (...args: string[]) => runScript('packages/proxy/src/cli.ts', cwd, args, env);
  return { cwd, git, base, env, cli };
}

test('attest-diff: every change produced by a signed write_file step is green, with JUnit and a signed attestation', async () => {
  const repo = await agentRepo();
  const receipts = readFileSync(join(repo.cwd, '.blackbox/session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
  assert.deepEqual(receipts[0].artifacts, [{ path: 'src/a.ts', blob: repo.git('hash-object', 'src/a.ts') }]);
  assert.deepEqual(receipts[1].artifacts, [{ path: 'src/new.ts', blob: repo.git('hash-object', 'src/new.ts') }]);
  assert.equal(receipts[2].outcome, 'denied');
  const result = repo.cli('attest-diff', '--base', repo.base, '--junit', 'attest.xml', '--out', 'attest.json');
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /ok {3}matches the write signed at step 1\nok {3}matches the write signed at step 2\nPASS attest-diff: 2 changed file\(s\)/);
  const xml = readFileSync(join(repo.cwd, 'attest.xml'), 'utf8');
  assert.match(xml, /tests="2" failures="0"/);
  const attestation = JSON.parse(readFileSync(join(repo.cwd, 'attest.json'), 'utf8')) as DiffAttestation;
  const { signature, ...unsigned } = attestation;
  assert.equal(attestation.ok, true);
  assert.equal(attestation.head, repo.git('rev-parse', 'HEAD'));
  assert.equal(verifyDigestSignature(publicKeyFromPem(attestation.publicKey), attestationDigest(unsigned), signature), true);
  assert.equal(verifyDigestSignature(publicKeyFromPem(attestation.publicKey), attestationDigest({ ...unsigned, ok: false }), signature), false);
  // The same check from a committed export, as a CI job would run it.
  assert.equal(repo.cli('export', 'receipts/run').code, 1);
  const fromExport = repo.cli('attest-diff', '--base', repo.base, '--from', 'receipts/run', '--ignore', 'attest.xml', '--ignore', 'attest.json');
  assert.equal(fromExport.code, 0, fromExport.out);
});

test('attest-diff: a human edit after the agent wrote the file is red, naming the step', async () => {
  const repo = await agentRepo();
  appendFileSync(join(repo.cwd, 'src/a.ts'), '// quick fix by hand\n');
  const result = repo.cli('attest-diff', '--base', repo.base, '--junit', 'attest.xml');
  assert.equal(result.code, 1);
  assert.match(result.out, /FAIL src\/a\.ts changed after its recorded write \(step 1 wrote [0-9a-f]{10}, the file is now [0-9a-f]{10}\)/);
  assert.match(result.out, /FAIL attest-diff: 1 of 2 changed file\(s\)/);
  assert.match(readFileSync(join(repo.cwd, 'attest.xml'), 'utf8'), /tests="2" failures="1"[\s\S]*<failure message="src\/a\.ts changed after its recorded write/);
});

test('attest-diff: a file written around the proxy (bypass) or deleted is red as an unrecorded change', async () => {
  const repo = await agentRepo();
  writeFileSync(join(repo.cwd, 'src/sneaky.ts'), 'export const leak = process.env;\n');
  repo.git('rm', '-q', 'README.md');
  const result = repo.cli('attest-diff', '--base', repo.base);
  assert.equal(result.code, 1);
  assert.match(result.out, /FAIL unrecorded change: README\.md was deleted/);
  assert.match(result.out, /FAIL unrecorded change: src\/sneaky\.ts\n/);
  assert.match(result.out, /FAIL attest-diff: 2 of 4 changed file\(s\)/);
});
