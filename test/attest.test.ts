import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicKeyFromPem, verifyDigestSignature, type Receipt } from '../packages/verify/src/index.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';
import { attestationDigest, type DiffAttestation } from '../packages/proxy/src/attest.ts';
import { repoRoot, runScript } from './fixtures/run.ts';

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
  assert.match(result.out, /ok {3}src\/a\.ts: matches the write signed at step 1\nok {3}src\/new\.ts: matches the write signed at step 2\nPASS attest-diff: 2 changed file\(s\)/);
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

// The CI entry point (.github/workflows/attest-diff.yml and the GitLab attest-diff job) as a real
// subprocess on real commits: it finds the request's exported session itself.
const prScript = join(repoRoot, 'scripts/ci/attest-diff-pr.sh');
function runPrScript(cwd: string, base: string, env: Record<string, string | undefined>): { code: number; out: string } {
  const options = { cwd, encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env, BLACKBOX_KEY_DIR: undefined, BLACKBOX_CLI: join(repoRoot, 'packages/proxy/src/cli.ts'), NODE_OPTIONS: `--conditions=source --import ${import.meta.resolve('tsx')}` } };
  try { return { code: 0, out: execFileSync('bash', [prScript, base, 'ci-out'], options) }; } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { code: failure.status, out: failure.stdout + failure.stderr };
  }
}
const commitAll = (repo: Awaited<ReturnType<typeof agentRepo>>, message: string) => { repo.git('add', '-A'); repo.git('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qm', message); };

test('attest-diff-pr.sh: a committed agent export gates the request green; a human edit on the branch turns it red, named in the JUnit summary', async () => {
  const repo = await agentRepo();
  // The private store and the job's output folder stay out of commits, as a repo's .gitignore would keep them.
  appendFileSync(join(repo.cwd, '.git/info/exclude'), '.blackbox/\nci-out/\n');
  assert.equal(repo.cli('export', 'receipts/run').code, 1); // the denied .env write makes the prover FAIL; the receipts still gate the diff
  commitAll(repo, 'agent change with its exported receipts');
  const green = runPrScript(repo.cwd, repo.base, repo.env);
  assert.equal(green.code, 0, green.out);
  assert.match(green.out, /== attest-diff against [0-9a-f]{40} using receipts\/run\n/);
  assert.match(green.out, /PASS attest-diff: 2 changed file\(s\)/);
  assert.match(green.out, /: 2 test\(s\), 0 failure\(s\)\n {2}ok {3}src\/a\.ts\n {2}ok {3}src\/new\.ts\n/);
  const attestation = JSON.parse(readFileSync(join(repo.cwd, 'ci-out/attest-diff.json'), 'utf8')) as DiffAttestation;
  assert.equal(attestation.ok, true);
  assert.equal(attestation.head, repo.git('rev-parse', 'HEAD'));

  appendFileSync(join(repo.cwd, 'src/new.ts'), '// tweaked by hand\n');
  commitAll(repo, 'human edit on the agent branch');
  const red = runPrScript(repo.cwd, repo.base, repo.env);
  assert.equal(red.code, 1, red.out);
  assert.match(red.out, /: 2 test\(s\), 1 failure\(s\)\n {2}ok {3}src\/a\.ts\n {2}FAIL src\/new\.ts - src\/new\.ts changed after its recorded write \(step 2 wrote /);
});

test('attest-diff-pr.sh: a request with no exported session is not gated; two sessions in one request fail', async () => {
  const repo = await agentRepo();
  appendFileSync(join(repo.cwd, '.git/info/exclude'), '.blackbox/\nci-out/\n');
  commitAll(repo, 'change without receipts');
  const none = runPrScript(repo.cwd, repo.base, repo.env);
  assert.equal(none.code, 0, none.out);
  assert.match(none.out, /^NOT APPLICABLE attest-diff: this request adds no exported agent session/);
  repo.cli('export', 'receipts/one');
  repo.cli('export', 'receipts/two');
  commitAll(repo, 'two exports');
  const two = runPrScript(repo.cwd, repo.base, repo.env);
  assert.equal(two.code, 1, two.out);
  assert.match(two.out, /^FAIL attest-diff: this request adds 2 exported sessions \(receipts\/one receipts\/two\)/);
  const badBase = runPrScript(repo.cwd, 'f'.repeat(40), repo.env);
  assert.equal(badBase.code, 1);
  assert.match(badBase.out, /is not a commit in this clone/);
});

test('committed demo output (receipts/attest-diff-demo): exports verify, attestations are signed, verdicts match the exit codes', async () => {
  const { readdirSync } = await import('node:fs');
  const { verifyChain, verifySeal, merkleRoot } = await import('../packages/verify/src/index.ts');
  const demo = join(repoRoot, 'receipts/attest-diff-demo');
  const expected: Record<string, { ok: boolean; failing: string[] }> = {
    'agent-clean': { ok: true, failing: [] },
    'agent-human-edit': { ok: false, failing: ['examples/injection-repo/CHANGELOG.md'] },
    'agent-bypass': { ok: false, failing: ['examples/injection-repo/src/debug.ts'] },
  };
  for (const [branch, want] of Object.entries(expected)) {
    const dir = join(demo, branch);
    const attestation = JSON.parse(readFileSync(join(dir, 'attest-diff.json'), 'utf8')) as DiffAttestation;
    const { signature, ...unsigned } = attestation;
    assert.equal(verifyDigestSignature(publicKeyFromPem(attestation.publicKey), attestationDigest(unsigned), signature), true, branch);
    assert.equal(attestation.ok, want.ok, branch);
    assert.deepEqual(attestation.files.filter((file) => !file.ok).map((file) => file.path), want.failing, branch);
    assert.equal(readFileSync(join(dir, 'exit-code'), 'utf8').trim(), want.ok ? '0' : '1', branch);
    // The session the gate read (human-edit reuses agent-clean's) still verifies from its exported files.
    const sessionDir = join(demo, branch === 'agent-human-edit' ? 'agent-clean' : branch, 'receipts');
    const [session] = readdirSync(sessionDir);
    assert.equal(session, attestation.sessionId, branch);
    const receipts = readFileSync(join(sessionDir, session, 'session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
    const publicKey = readFileSync(join(sessionDir, session, 'public-key.pem'), 'utf8');
    assert.equal(verifyChain(receipts, publicKey).valid, true, branch);
    assert.equal(verifySeal(JSON.parse(readFileSync(join(sessionDir, session, 'seal.json'), 'utf8')), receipts, publicKey, 'exact').valid, true, branch);
    assert.equal(merkleRoot(receipts.map(({ hash }) => hash)), attestation.root, branch);
  }
});
