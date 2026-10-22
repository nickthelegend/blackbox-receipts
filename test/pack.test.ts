import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyFingerprint, noSecretsPolicyV1, parsePack, policyHash, verifyPack, type Pack } from '../packages/verify/src/index.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';
import { repoRoot, runScript } from './fixtures/run.ts';

// Packs are verified by @blackbox/verify, the same code the dashboard's /verify page runs in the browser.
async function realPack(): Promise<{ text: string; pack: Pack; cwd: string; env: Record<string, string | undefined> }> {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-pack-'));
  for (const name of ['a.md', 'b.md', 'c.md', 'd.md', 'e.md']) writeFileSync(join(cwd, name), `# ${name}\n`);
  const env = { RECEIPTS_DIR: join(cwd, '.blackbox'), BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  const client = await connectProxy({ cwd, env });
  try { for (const name of ['a.md', 'b.md', 'c.md', 'd.md', 'e.md']) await client.callTool({ name: 'read_file', arguments: { path: name } }); } finally { await client.close(); }
  const made = runScript('packages/proxy/src/cli.ts', cwd, ['pack', 'session.pack.json'], env);
  assert.equal(made.code, 0, made.out);
  assert.match(made.out, /^PASS no-secrets-read\/v2: 5 receipts, chain intact, seal matches, proof verified/);
  const text = readFileSync(join(cwd, 'session.pack.json'), 'utf8');
  assert.doesNotMatch(text, /-----BEGIN PRIVATE KEY-----/);
  return { text, pack: parsePack(text), cwd, env };
}

/** Changes exactly one character of the pack file, inside the given receipt's given field. */
function flipOneByte(text: string, step: number, field: 'resultHash' | 'signature' | 'tool'): string {
  const pack = JSON.parse(text) as Pack;
  const value = String(pack.receipts[step - 1][field]);
  const at = text.indexOf(JSON.stringify(value).slice(1, -1), text.indexOf(`"step": ${step},`));
  const char = text[at + 3];
  const replacement = field === 'tool' ? (char === 'x' ? 'y' : 'x') : char === 'A' ? 'B' : char === '0' ? '1' : char === 'a' ? 'b' : 'A';
  const changed = `${text.slice(0, at + 3)}${replacement}${text.slice(at + 4)}`;
  assert.equal([...changed].filter((c, index) => c !== text[index]).length, 1);
  return changed;
}

test('pack: a real session packs and verifies offline; one changed byte turns it red at that step', async () => {
  const { text, pack } = await realPack();
  const clean = verifyPack(pack);
  assert.equal(clean.ok, true, clean.headline);
  assert.deepEqual(clean.steps.map((item) => item.status), ['ok', 'ok', 'ok', 'ok', 'ok']);
  for (const [field, reason] of [['resultHash', 'Receipt contents were changed'], ['tool', 'Receipt contents were changed'], ['signature', 'Signature is invalid']] as const) {
    const result = verifyPack(parsePack(flipOneByte(text, 3, field)));
    assert.equal(result.ok, false);
    assert.equal(result.brokenAt, 3, `${field}: ${result.headline}`);
    assert.equal(result.headline, `FAIL at step 3: ${reason}`);
    assert.deepEqual(result.steps.map((item) => item.status), ['ok', 'ok', 'broken', 'untrusted', 'untrusted']);
  }
});

test('pack: truncation, a forged proof and a wrong key are each caught', async () => {
  const { pack } = await realPack();
  const truncated = structuredClone(pack);
  truncated.receipts.pop();
  assert.match(verifyPack(truncated).headline, /^FAIL seal: Seal says 5 receipts ending at [0-9a-f]{12}, but the log has 4/);
  const forged = structuredClone(pack);
  forged.proof!.steps[1].commitment = '0'.repeat(64);
  assert.equal(verifyPack(forged).headline, 'FAIL property: Proxy attestation over the property commitments is invalid');
  const otherKey = structuredClone(pack);
  otherKey.publicKey = readFileSync(join(repoRoot, 'receipts/agent-demo', readdirSync(join(repoRoot, 'receipts/agent-demo'))[0], 'public-key.pem'), 'utf8');
  assert.equal(verifyPack(otherKey).headline, 'FAIL at step 1: Signature is invalid');
  assert.match(verifyPack(pack, { pinnedPublicKey: otherKey.publicKey }).headline, /^FAIL: Pack public key does not match the pinned key/);
});

test('pack CLI: verify-pack exits 0 on the real pack and 1 on a one-byte edit; --from packs the committed agent run that FAILed', async () => {
  const { text, cwd, env } = await realPack();
  const ok = runScript('packages/proxy/src/cli.ts', cwd, ['verify-pack', 'session.pack.json'], env);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /ok {3}chain: 5 signatures and hash links verify/);
  writeFileSync(join(cwd, 'edited.json'), flipOneByte(text, 2, 'resultHash'));
  const bad = runScript('packages/proxy/src/cli.ts', cwd, ['verify-pack', 'edited.json'], env);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /^FAIL at step 2: Receipt contents were changed/);
  const failedRun = readdirSync(join(repoRoot, 'receipts/agent-demo')).find((id) => readFileSync(join(repoRoot, 'receipts/agent-demo', id, 'result.txt'), 'utf8').startsWith('FAIL'))!;
  const packed = runScript('packages/proxy/src/cli.ts', cwd, ['pack', join(cwd, 'agent.json'), '--from', join(repoRoot, 'receipts/agent-demo', failedRun)], env);
  assert.match(packed.out, /^FAIL no-secrets-read\/v2 at step 3: No proof: step 3 \(read_file \.env\) is signed as a secret access/);
  const result = verifyPack(parsePack(readFileSync(join(cwd, 'agent.json'), 'utf8')));
  assert.deepEqual(result.checks.map((item) => [item.name, item.ok]), [['format', true], ['key', true], ['chain', true], ['seal', true], ['property', false]]);
  assert.equal(result.steps[2].status, 'flagged');
});

test('verifyPack: keyPinned is true only for a matching pinned key, compared as key bytes, with the key fingerprint', () => {
  const sample = parsePack(readFileSync(join(repoRoot, 'apps/web/app/verify/samples/agent-pass.json'), 'utf8'));
  const v1 = { expectedPolicyId: noSecretsPolicyV1.id, expectedPolicyHash: policyHash(noSecretsPolicyV1) };
  const unpinned = verifyPack(sample, v1);
  assert.equal(unpinned.ok, true);
  assert.equal(unpinned.keyPinned, false);
  assert.match(unpinned.keyFingerprint ?? '', /^[0-9a-f]{64}$/);
  assert.equal(unpinned.keyFingerprint, keyFingerprint(sample.publicKey));
  const crlf = verifyPack(sample, { ...v1, pinnedPublicKey: sample.publicKey.replace(/\n/g, '\r\n') });
  assert.equal(crlf.ok, true);
  assert.equal(crlf.keyPinned, true);
  const garbage = verifyPack(sample, { ...v1, pinnedPublicKey: 'not a key' });
  assert.equal(garbage.ok, false);
  assert.equal(garbage.keyPinned, false);
  assert.match(garbage.headline, /^FAIL: The pinned key is not an Ed25519 public key PEM/);
});
