import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import * as receiptsLib from '../packages/receipts/src/index.ts';
import { DEFAULT_POLICY_HASH, defaultSecretPolicy, evaluateCall, policyHash, proveProperty, verifyPropertyProof, type Receipt } from '../packages/receipts/src/index.ts';
import { isSecretPath } from '../packages/proxy/src/store.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';
import { buildSession, cleanCalls, writeSessionDir } from './fixtures/session.ts';
import { repoRoot, runScript } from './fixtures/run.ts';

// The headline question is "did the agent ever read a secret?". The default policy must cover the places
// credentials actually live on a developer machine, not only .env and key files: git's config and
// credential store, package-manager and database credential files, client certificates, and the .ssh
// directory itself.

const CREDENTIAL_STORES = ['.git/config', '.git/credentials', 'sub/repo/.git/config', '.git-credentials', '.npmrc', 'packages/app/.npmrc', '.netrc', `${homedir()}/.netrc`, '~/.netrc', '.pypirc', '.pgpass', 'certs/client.p12', 'signing/id.pfx', '.ssh', '~/.ssh', `${homedir()}/.ssh`, '.docker/config.json', '.kube/config', '.gnupg/private-keys-v1.d/abc.key', '.gnupg/pubring.kbx'];
const ORDINARY = ['src/git.ts', '.gitignore', '.github/workflows/ci.yml', '.gitlab-ci.yml', 'docs/netrc.md', 'package.json', 'npmrc.md', 'src/ssh.ts', '.sshrc.example', 'README.md', '.'];

// The exact v1 policy the committed agent runs were proven under on 2026-10-21 (hash 720836167c0f…).
const noSecretsPolicyV1 = (receiptsLib as Record<string, unknown>).noSecretsPolicyV1 as typeof defaultSecretPolicy | undefined;

test('policy v2: git, npm, netrc, pgpass, pypirc, p12/pfx, docker, kube, gnupg and the .ssh directory are secret; ordinary files are not', () => {
  const allowed = CREDENTIAL_STORES.filter((path) => evaluateCall('read_file', [path], { path }, defaultSecretPolicy) === null);
  assert.deepEqual(allowed, [], 'the default policy allows reading these credential stores');
  const flagged = ORDINARY.filter((path) => evaluateCall('read_file', [path], { path }, defaultSecretPolicy) !== null);
  assert.deepEqual(flagged, [], 'ordinary files must not be flagged');
  // Through shell arguments too, the way an agent would try it.
  for (const command of ['cat .npmrc', 'cat .git/config', 'ls .ssh', 'ls -la ~/.ssh', 'cat $HOME/.netrc']) {
    assert.notEqual(evaluateCall('shell', [], { command }, defaultSecretPolicy), null, command);
  }
  assert.equal(defaultSecretPolicy.id, 'no-secrets-read/v2');
  assert.equal(DEFAULT_POLICY_HASH, policyHash(defaultSecretPolicy));
});

test('policy v2: the proxy guard treats the .ssh directory itself as secret', () => {
  for (const path of ['.ssh', 'home/me/.ssh', '.ssh/id_ed25519', '.gnupg']) assert.equal(isSecretPath(path), true, path);
  for (const path of ['src/ssh.ts', '.sshrc.example', 'README.md']) assert.equal(isSecretPath(path), false, path);
});

test('policy v1 stays frozen and published, so runs recorded under it verify when it is pinned explicitly', () => {
  assert.ok(noSecretsPolicyV1, '@blackbox/receipts exports noSecretsPolicyV1');
  assert.equal(noSecretsPolicyV1.id, 'no-secrets-read/v1');
  assert.ok(policyHash(noSecretsPolicyV1).startsWith('720836167c0f'), 'v1 must hash exactly as it did when the committed runs were proven');
  assert.notEqual(policyHash(noSecretsPolicyV1), DEFAULT_POLICY_HASH);
  for (const glob of noSecretsPolicyV1.secretPathGlobs) assert.ok(defaultSecretPolicy.secretPathGlobs.includes(glob), `v2 keeps v1's ${glob}`);
  assert.deepEqual(defaultSecretPolicy.secretArgPatterns, noSecretsPolicyV1.secretArgPatterns);

  // A proof made under v1 does not satisfy the default (v2) pin: v1 never looked at .git/config or .npmrc.
  const session = buildSession(cleanCalls);
  const v1 = proveProperty(session.receipts, session.witnesses, noSecretsPolicyV1, session.keys);
  assert.equal(v1.valid, true);
  if (!v1.valid) return;
  const underDefault = verifyPropertyProof(v1.proof, session.keys.publicKey);
  assert.equal(underDefault.valid, false);
  if (!underDefault.valid) assert.match(underDefault.reason, /^Proof was made under policy "no-secrets-read\/v1" \(720836167c0f\), not the pinned policy/);
  assert.equal(verifyPropertyProof(v1.proof, session.keys.publicKey, undefined, policyHash(noSecretsPolicyV1)).valid, true);

  // The CLI pins a published policy by its id.
  const dir = writeSessionDir(session);
  writeFileSync(join(dir, 'v1.json'), JSON.stringify(noSecretsPolicyV1));
  const env = { RECEIPTS_DIR: dir, BLACKBOX_KEY_DIR: dir, RECEIPTS_SIGNING_KEY: undefined, BLACKBOX_POLICY_HASH: undefined };
  const byId = runScript('packages/proxy/src/cli.ts', dir, ['prove', '--policy', join(dir, 'v1.json'), '--expect-policy', 'no-secrets-read/v1', '--out', join(dir, 'p.json')], env);
  assert.equal(byId.code, 0, byId.out);
  assert.match(byId.out, /^PASS no-secrets-read \[policy no-secrets-read\/v1 720836167c0f\]/);
  const unknown = runScript('packages/proxy/src/cli.ts', dir, ['verify-proof', join(dir, 'p.json'), '--expect-policy', 'no-secrets-read/v9'], env);
  assert.equal(unknown.code, 2, unknown.out);
  assert.match(unknown.out, /no-secrets-read\/v9 is neither a published policy \(no-secrets-read\/v2, no-secrets-read\/v1\) nor a readable policy file/);
});

test('committed v1 agent run: verify-pack FAILs it under the default v2 pin, naming v1, and PASSes it pinned to v1', () => {
  const pack = join(repoRoot, 'receipts/agent-demo/e51c6b41-baba-404e-97a9-9bb2270924a0/pack.json');
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-v1pack-'));
  const env = { RECEIPTS_DIR: join(cwd, 'store'), BLACKBOX_KEY_DIR: join(cwd, 'keys'), BLACKBOX_PUBLIC_KEY: undefined, BLACKBOX_POLICY_HASH: undefined };
  const current = runScript('packages/proxy/src/cli.ts', cwd, ['verify-pack', pack], env);
  assert.equal(current.code, 1, current.out);
  assert.match(current.out, /^FAIL property: Proof was made under policy "no-secrets-read\/v1" \(720836167c0f\), not the pinned policy/);
  const pinned = runScript('packages/proxy/src/cli.ts', cwd, ['verify-pack', pack, '--expect-policy', 'no-secrets-read/v1'], env);
  assert.equal(pinned.code, 0, pinned.out);
  assert.match(pinned.out, /^PASS no-secrets-read\/v1: 14 receipts, chain intact, seal matches, proof verified/);
  const byHash = runScript('packages/proxy/src/cli.ts', cwd, ['verify-pack', pack], { ...env, BLACKBOX_POLICY_HASH: '720836167c0f60751f90615f1a0303c1a9714b2b40e88faf41926b5acec5ca56' });
  assert.equal(byHash.code, 0, byHash.out);
  assert.match(byHash.out, /^PASS no-secrets-read\/v1: /, 'a published policy pinned by hash is named by its id');
});

test('guard (real proxy): credential-store reads are denied before they run, recorded as secret access, and the proof FAILs there', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-credstores-'));
  writeFileSync(join(cwd, 'notes.md'), '# notes\n');
  mkdirSync(join(cwd, '.git'));
  writeFileSync(join(cwd, '.git/config'), '[remote "origin"]\n\turl = https://user:GIT-CANARY@example.invalid/repo.git\n');
  writeFileSync(join(cwd, '.npmrc'), '//registry.npmjs.org/:_authToken=NPM-CANARY\n');
  writeFileSync(join(cwd, '.netrc'), 'machine example.invalid login me password NETRC-CANARY\n');
  mkdirSync(join(cwd, '.ssh'));
  writeFileSync(join(cwd, '.ssh/known_hosts'), 'SSH-CANARY\n');
  const dataDir = join(cwd, '.blackbox');
  const env = { RECEIPTS_DIR: dataDir, BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  const client = await connectProxy({ cwd, env });
  const results = [];
  try {
    results.push(await client.callTool({ name: 'read_file', arguments: { path: 'notes.md' } }));
    results.push(await client.callTool({ name: 'read_file', arguments: { path: '.git/config' } }));
    results.push(await client.callTool({ name: 'read_file', arguments: { path: '.npmrc' } }));
    results.push(await client.callTool({ name: 'shell', arguments: { command: 'cat .netrc' } }));
    results.push(await client.callTool({ name: 'shell', arguments: { command: 'ls .ssh' } }));
  } finally { await client.close(); }
  const texts = results.map((result) => (result.content as { text: string }[])[0].text);
  assert.deepEqual(results.map((result) => Boolean(result.isError)), [false, true, true, true, true], texts.join('\n'));
  assert.equal(texts[1], 'Policy denied (no-secrets-read/v2): read_file touched secret path matching ".git/**"');
  assert.equal(texts[2], 'Policy denied (no-secrets-read/v2): read_file touched secret path matching ".npmrc"');
  assert.equal(texts[3], 'Policy denied (no-secrets-read/v2): shell touched secret path matching ".netrc"');
  assert.equal(texts[4], 'Policy denied (no-secrets-read/v2): shell touched secret path matching ".ssh"');
  assert.doesNotMatch(texts.join(''), /CANARY/);
  const receipts = readFileSync(join(dataDir, 'session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
  assert.deepEqual(receipts.map((item) => [item.outcome, item.secretsAccessed]), [['ok', false], ['denied', true], ['denied', true], ['denied', true], ['denied', true]]);
  const proved = runScript('packages/proxy/src/cli.ts', cwd, ['prove'], env);
  assert.equal(proved.code, 1);
  assert.match(proved.out, /^FAIL no-secrets-read at step 2 \[policy no-secrets-read\/v2 [0-9a-f]{12}\]: read_file touched secret path matching "\.git\/\*\*"/);
});
