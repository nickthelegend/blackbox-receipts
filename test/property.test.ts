import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { argsMatch, defaultSecretPolicy, discloseStep, hashArgs, policyHash, sha256, proveProperty, verifyDisclosure, verifyPropertyProof, type PropertyProof, type SecretPolicy } from '../packages/receipts/src/index.ts';
import { buildSession, cleanCalls, writeSessionDir, type Call } from './fixtures/session.ts';

const secretCalls: Call[] = [cleanCalls[0], { tool: 'read_file', args: { path: '.env.local' }, paths: ['.env.local'], secretsAccessed: true }, cleanCalls[2]];

function prove(session: ReturnType<typeof buildSession>) {
  return proveProperty(session.receipts, session.witnesses, defaultSecretPolicy, session.keys);
}

function provenBundle(session = buildSession(cleanCalls)): { session: ReturnType<typeof buildSession>; proof: PropertyProof } {
  const result = prove(session);
  if (!result.valid) throw new Error(result.reason);
  return { session, proof: result.proof };
}

test('clean chain: proof passes and reveals no raw arguments', () => {
  const { session, proof } = provenBundle();
  assert.deepEqual(verifyPropertyProof(proof, session.keys.publicKey, proof.root), { valid: true, steps: 5, root: proof.root, policyHash: proof.policyHash, policyId: 'no-secrets-read/v1' });
  const published = JSON.stringify(proof);
  for (const hidden of ['src/index.ts', 'ls -la src', 'README.md', '"pwd"', 'argsHash', 'resultHash']) assert.equal(published.includes(hidden), false, `proof leaks ${hidden}`);
  assert.deepEqual(Object.keys(proof.steps[0]).sort(), ['commitment', 'inclusion', 'leaf', 'signature', 'step']);
});

test('tampered chain: proving fails and names the edited step', () => {
  const session = buildSession(cleanCalls);
  session.receipts[2].tool = 'shell-edited';
  assert.deepEqual(prove(session), { valid: false, step: 3, reason: 'Chain verification failed: Receipt contents were changed' });
});

test('tampered proof bundle: verification fails and names the offending step', () => {
  const { session, proof } = provenBundle();
  const swappedLeaf: PropertyProof = structuredClone(proof);
  swappedLeaf.steps[3].leaf = swappedLeaf.steps[1].leaf;
  assert.deepEqual(verifyPropertyProof(swappedLeaf, session.keys.publicKey), { valid: false, step: 4, reason: 'Receipt signature is invalid' });
  const dropped: PropertyProof = structuredClone(proof);
  dropped.steps.splice(1, 1);
  dropped.receiptCount = 4;
  assert.equal(verifyPropertyProof(dropped, session.keys.publicKey).valid, false);
  const forgedCommitment: PropertyProof = structuredClone(proof);
  forgedCommitment.steps[0].commitment = '0'.repeat(64);
  assert.equal(verifyPropertyProof(forgedCommitment, session.keys.publicKey).valid, false);
  assert.equal(verifyPropertyProof(proof, buildSession(cleanCalls).keys.publicKey).valid, false);
});

test('empty session: proving fails instead of claiming the property', () => {
  const result = prove(buildSession([]));
  assert.equal(result.valid, false);
  if (!result.valid) { assert.equal(result.step, null); assert.match(result.reason, /No receipts exist/); }
});

test('secret path: proving fails and names the step and matching rule', () => {
  assert.deepEqual(prove(buildSession(secretCalls)), { valid: false, step: 2, reason: 'read_file touched secret path matching ".env*"' });
  const ssh = prove(buildSession([cleanCalls[3], { tool: 'shell', args: { command: `cat ${homedir()}/.ssh/config` } }]));
  assert.deepEqual(ssh, { valid: false, step: 2, reason: 'shell touched secret path matching "~/.ssh/**"' });
  const pem = prove(buildSession([{ tool: 'git', args: { action: 'show', args: ['HEAD:deploy/server.pem'] } }]));
  assert.deepEqual(pem, { valid: false, step: 1, reason: 'git touched secret path matching "*.pem"' });
});

test('secret pattern in shell args: proving fails and names the pattern', () => {
  const result = prove(buildSession([cleanCalls[0], cleanCalls[1], { tool: 'shell', args: { command: 'ls glpat-abcdefghijklmnopqrstuv' } }]));
  assert.deepEqual(result, { valid: false, step: 3, reason: 'shell arguments match secret pattern "gitlab-token"' });
});

test('missing or mismatched witness fails rather than passing unchecked', () => {
  const missing = buildSession(cleanCalls);
  missing.witnesses.splice(2, 1);
  assert.deepEqual(prove(missing), { valid: false, step: 3, reason: 'Raw arguments for this step are missing, so the policy cannot be evaluated' });
  const swapped = buildSession(cleanCalls);
  swapped.witnesses[1].args = { path: 'src/other.ts' };
  assert.deepEqual(prove(swapped), { valid: false, step: 2, reason: 'Stored arguments do not match the signed argsHash' });
});

test('selective disclosure opens exactly one step against the proof', () => {
  const { session, proof } = provenBundle();
  const opening = discloseStep(session.receipts, session.witnesses, 2, defaultSecretPolicy, session.keys.privateKey);
  assert.equal(verifyDisclosure(proof, opening, session.keys.publicKey).valid, true);
  assert.deepEqual(verifyDisclosure(proof, { ...opening, args: { path: 'src/elsewhere.ts' } }, session.keys.publicKey), { valid: false, step: 2, reason: 'Disclosed arguments do not match the signed argsHash' });
  assert.deepEqual(verifyDisclosure(proof, { ...opening, salt: '0'.repeat(64) }, session.keys.publicKey), { valid: false, step: 2, reason: 'Disclosure does not open the property commitment' });
});

// The real verifier CLI, run as a subprocess against sessions in the proxy's on-disk layout.
const repoRoot = resolve(import.meta.dirname, '..');
function cli(dir: string, ...args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, ['--conditions=source', '--import', 'tsx', 'packages/proxy/src/cli.ts', ...args], { cwd: repoRoot, env: { ...process.env, RECEIPTS_DIR: dir, BLACKBOX_KEY_DIR: dir }, encoding: 'utf8' });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { code: failure.status, out: failure.stdout + failure.stderr };
  }
}

test('verifier CLI: PASS on a clean chain, then verify-proof accepts the written bundle', () => {
  const dir = writeSessionDir(buildSession(cleanCalls));
  const proved = cli(dir, 'prove');
  assert.equal(proved.code, 0, proved.out);
  assert.match(proved.out, /^PASS no-secrets-read \[policy no-secrets-read\/v1 [0-9a-f]{12}\]: 5\/5 receipts/);
  const verified = cli(dir, 'verify-proof', join(dir, 'proof-no-secrets.json'), '--public-key', join(dir, 'public-key.pem'));
  assert.equal(verified.code, 0, verified.out);
  assert.match(verified.out, /^PASS no-secrets-read \[policy no-secrets-read\/v1 [0-9a-f]{12}\]: 5 receipts proven/);
  const proof = JSON.parse(readFileSync(join(dir, 'proof-no-secrets.json'), 'utf8')) as PropertyProof;
  proof.steps[1].inclusion[0].hash = 'f'.repeat(64);
  writeFileSync(join(dir, 'tampered-proof.json'), JSON.stringify(proof));
  const rejected = cli(dir, 'verify-proof', join(dir, 'tampered-proof.json'));
  assert.equal(rejected.code, 1);
  assert.match(rejected.out, /^FAIL no-secrets-read at step 2 \[policy no-secrets-read\/v1 [0-9a-f]{12}\]: Merkle inclusion proof does not reach the session root/);
});

test('verifier CLI: FAIL on a tampered chain naming the step', () => {
  const dir = writeSessionDir(buildSession(cleanCalls));
  assert.equal(cli(dir, 'tamper').code, 0);
  const result = cli(dir, 'prove');
  assert.equal(result.code, 1);
  assert.match(result.out, /^FAIL no-secrets-read at step 1 \[policy no-secrets-read\/v1 [0-9a-f]{12}\]: Chain verification failed: Receipt contents were changed/);
});

test('verifier CLI: FAIL on an empty session', () => {
  const result = cli(writeSessionDir(buildSession([])), 'prove');
  assert.equal(result.code, 1);
  assert.match(result.out, /^FAIL no-secrets-read \[policy no-secrets-read\/v1 [0-9a-f]{12}\]: No receipts exist for this session/);
});

test('verifier CLI: FAIL on a session that touched a secret path, naming the step', () => {
  const result = cli(writeSessionDir(buildSession(secretCalls)), 'prove');
  assert.equal(result.code, 1);
  assert.match(result.out, /^FAIL no-secrets-read at step 2 \[policy no-secrets-read\/v1 [0-9a-f]{12}\]: read_file touched secret path matching "\.env\*"/);
});

test('policy pinning: a proof made under a weaker policy fails verification, and the CLI names both policies', () => {
  const empty: SecretPolicy = { id: 'empty', secretPathGlobs: [], secretArgPatterns: [] };
  const weak = buildSession(cleanCalls);
  const result = proveProperty(weak.receipts, weak.witnesses, empty, weak.keys);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  const pinnedDefault = verifyPropertyProof(result.proof, weak.keys.publicKey);
  assert.equal(pinnedDefault.valid, false);
  if (!pinnedDefault.valid) assert.match(pinnedDefault.reason, /^Proof was made under policy "empty" \([0-9a-f]{12}\), not the pinned policy/);
  assert.equal(verifyPropertyProof(result.proof, weak.keys.publicKey, undefined, policyHash(empty)).valid, true);
  const dir = writeSessionDir(weak);
  writeFileSync(join(dir, 'empty.json'), JSON.stringify(empty));
  const weakProve = cli(dir, 'prove', '--policy', join(dir, 'empty.json'));
  assert.equal(weakProve.code, 1);
  assert.match(weakProve.out, /^FAIL no-secrets-read \[policy no-secrets-read\/v1 [0-9a-f]{12}\]: Proof was made under policy "empty"/);
  const explicit = cli(dir, 'prove', '--policy', join(dir, 'empty.json'), '--expect-policy', join(dir, 'empty.json'));
  assert.equal(explicit.code, 0, explicit.out);
  assert.match(explicit.out, /^PASS no-secrets-read \[policy empty [0-9a-f]{12}\]/);
});

test('argsHash is salted: guessing the arguments does not reproduce it, the witness salt does', () => {
  const session = buildSession(cleanCalls);
  const receipt = session.receipts[1];
  assert.notEqual(receipt.argsHash, sha256(JSON.stringify({ path: 'src/index.ts' })));
  assert.notEqual(receipt.argsHash, hashArgs({ path: 'src/index.ts' }, ''));
  assert.equal(hashArgs({ path: 'src/index.ts' }, session.witnesses[1].salt!), receipt.argsHash);
  assert.equal(argsMatch(receipt.argsHash, { path: 'src/index.ts' }, session.witnesses[1].salt), true);
  assert.equal(argsMatch(receipt.argsHash, { path: 'src/other.ts' }, session.witnesses[1].salt), false);
});

test('explain: step-cited markdown with the verdict, each call, and why the failing step fails', () => {
  const dir = writeSessionDir(buildSession(secretCalls));
  const result = cli(dir, 'explain');
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /\*\*Verdict:\*\* `FAIL no-secrets-read at step 2 \[policy no-secrets-read\/v1 [0-9a-f]{12}\]: read_file touched secret path matching "\.env\*"`/);
  assert.match(result.out, /- \*\*step 1\*\* \d\d:\d\d:\d\d `git status` → recorded/);
  assert.match(result.out, /- \*\*step 2\*\* \d\d:\d\d:\d\d `read_file \.env\.local` → recorded · receipt `[0-9a-f]{12}`/);
  assert.match(result.out, /- \*\*step 3\*\* \d\d:\d\d:\d\d `shell ls -la src`/);
  assert.match(result.out, /## Why\n\n- \*\*step 2\*\* `read_file \.env\.local` violates `no-secrets-read\/v1`: read_file touched secret path matching "\.env\*"\.(?: .*)? It came right after step 1 `git status`\./);
  const clean = cli(writeSessionDir(buildSession(cleanCalls)), 'explain');
  assert.match(clean.out, /No step touches a path or argument that `no-secrets-read\/v1` forbids\./);
});
