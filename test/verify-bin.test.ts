import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRoot } from './fixtures/run.ts';

// `npx ./blackbox-verify-0.1.0.tgz <pack.json>`: the committed tarball under release/ must match a fresh
// `pnpm pack` of packages/verify, and its bin must PASS, FAIL and name steps on real packs. The tarball is
// installed the way npm would lay it out; its two @noble dependencies are linked from this checkout so
// the test needs no network (the README records a real npx run).
const TARBALL = join(repoRoot, 'release/blackbox-verify-0.1.0.tgz');
const RUNS = join(repoRoot, 'receipts/agent-demo');
const PASS_PACK = join(RUNS, 'e51c6b41-baba-404e-97a9-9bb2270924a0/pack.json');
const FAIL_PACK = join(RUNS, '933f87da-c941-4588-8716-d6c8df98aded/pack.json');

function unpack(tarball: string): Map<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'blackbox-tgz-'));
  execFileSync('tar', ['-xzf', tarball, '-C', dir]);
  const files = new Map<string, string>();
  const walk = (sub: string) => { for (const entry of readdirSync(join(dir, sub), { withFileTypes: true })) { const path = join(sub, entry.name); if (entry.isDirectory()) walk(path); else files.set(path, readFileSync(join(dir, path), 'utf8')); } };
  walk('package');
  return files;
}

let installed: string | null = null;
function bin(...args: string[]): { code: number; out: string } {
  if (!installed) {
    const root = mkdtempSync(join(tmpdir(), 'blackbox-npx-'));
    const target = join(root, 'node_modules/@blackbox/verify');
    mkdirSync(target, { recursive: true });
    execFileSync('tar', ['-xzf', TARBALL, '-C', target, '--strip-components=1']);
    mkdirSync(join(root, 'node_modules/@noble'));
    for (const name of ['curves', 'hashes']) symlinkSync(realpathSync(join(repoRoot, 'packages/verify/node_modules/@noble', name)), join(root, 'node_modules/@noble', name));
    installed = join(target, JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).bin['blackbox-verify']);
  }
  try { return { code: 0, out: execFileSync(process.execPath, [installed, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BLACKBOX_PUBLIC_KEY: undefined } }) }; } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { code: failure.status, out: failure.stdout + failure.stderr };
  }
}

test('release/blackbox-verify-0.1.0.tgz is a current pnpm pack of packages/verify, with a blackbox-verify bin', () => {
  const out = mkdtempSync(join(tmpdir(), 'blackbox-pack-'));
  execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: join(repoRoot, 'packages/verify'), stdio: 'ignore' });
  const fresh = unpack(join(out, 'blackbox-verify-0.1.0.tgz'));
  const committed = unpack(TARBALL);
  assert.deepEqual([...committed.keys()].sort(), [...fresh.keys()].sort());
  for (const [path, content] of fresh) assert.equal(committed.get(path), content, `${path} differs: rebuild with pnpm pack --pack-destination ../../release`);
  const manifest = JSON.parse(committed.get('package/package.json')!);
  assert.equal(manifest.bin['blackbox-verify'], './dist/bin.js');
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['@noble/curves', '@noble/hashes']);
  assert.ok(committed.get('package/dist/bin.js')!.startsWith('#!/usr/bin/env node\n'));
  for (const [path, content] of committed) if (path !== 'package/dist/bin.js' && path.endsWith('.js')) assert.doesNotMatch(content, /from 'node:/, `${path} must stay browser-safe`);
});

test('blackbox-verify bin: committed packs PASS / FAIL at step 3 under v1, the policy they were recorded under; a one-byte change fails naming the step', () => {
  // Both committed runs were proven under no-secrets-read/v1 (2026-10-21), so they PASS only with v1 pinned.
  const pass = bin(PASS_PACK, '--expect-policy', 'no-secrets-read/v1');
  assert.equal(pass.code, 0, pass.out);
  assert.match(pass.out, /^PASS no-secrets-read\/v1: 14 receipts, chain intact, seal matches, proof verified\n/);
  assert.match(pass.out, / {2}ok {3}chain: 14 signatures and hash links verify\n/);
  // The default pin is v2, which the v1 proof does not satisfy: it fails on the property, naming both policies.
  const current = bin(PASS_PACK);
  assert.equal(current.code, 1, current.out);
  assert.match(current.out, /^FAIL property: Proof was made under policy "no-secrets-read\/v1" \(720836167c0f\), not the pinned policy \([0-9a-f]{12}\)\n/);
  assert.match(current.out, / {2}ok {3}chain: 14 signatures and hash links verify\n {2}ok {3}seal: Signed seal covers all 14 receipts\n/);
  const unknown = bin(PASS_PACK, '--expect-policy', 'no-secrets-read/v0');
  assert.equal(unknown.code, 2, unknown.out);
  assert.match(unknown.out, /no-secrets-read\/v0 is neither a published policy \(no-secrets-read\/v2, no-secrets-read\/v1\) nor a readable policy file/);

  const fail = bin(FAIL_PACK, '--expect-policy', 'no-secrets-read/v1');
  assert.equal(fail.code, 1, fail.out);
  assert.match(fail.out, /^FAIL no-secrets-read\/v1 at step 3: No proof: step 3 \(read_file \.env\) is signed as a secret access\n/);
  assert.match(fail.out, / {2}ok {3}chain: 10 signatures and hash links verify\n {2}ok {3}seal: Signed seal covers all 10 receipts\n/);

  // One byte of one receipt: the last hex digit of step 7's resultHash.
  const original = readFileSync(PASS_PACK, 'utf8');
  const marker = original.indexOf('"step": 7,');
  const at = original.indexOf('"resultHash": "', marker) + '"resultHash": "'.length + 63;
  const tampered = original.slice(0, at) + (original[at] === '0' ? '1' : '0') + original.slice(at + 1);
  assert.equal([...original].filter((char, index) => char !== tampered[index]).length, 1);
  const file = join(mkdtempSync(join(tmpdir(), 'blackbox-tamper-')), 'tampered.json');
  writeFileSync(file, tampered);
  const broken = bin(file);
  assert.equal(broken.code, 1, broken.out);
  assert.match(broken.out, /^FAIL at step 7: Receipt contents were changed\n/);
  assert.match(broken.out, / {2}step 7 broken: git \(Receipt contents were changed\)\n {2}step 8 untrusted: /);

  const otherKey = join(repoRoot, 'receipts/attest-diff-demo/agent-clean/receipts', readdirSync(join(repoRoot, 'receipts/attest-diff-demo/agent-clean/receipts'))[0], 'public-key.pem');
  const pinned = bin(PASS_PACK, '--public-key', otherKey);
  assert.equal(pinned.code, 1);
  assert.match(pinned.out, /FAIL key: Pack public key does not match the pinned key/);
  assert.equal(bin().code, 2);
  assert.equal(bin(join(repoRoot, 'no-such-pack.json')).code, 2);
});

// A pack whose receipts are the wrong shape must give a located FAIL (exit 1), never a stack trace.
test('blackbox-verify bin: malformed receipts (non-hex hash, missing paths, a null receipt) FAIL format at that step without a stack trace', async () => {
  const { runScript } = await import('./fixtures/run.ts');
  const dir = mkdtempSync(join(tmpdir(), 'blackbox-malformed-'));
  const variants: [string, (pack: { receipts: unknown[]; proof: unknown }) => void, RegExp][] = [
    ['bad-hash', (pack) => { (pack.receipts[0] as { hash: string }).hash = 'zz'; }, /^FAIL format at step 1: receipt hash is not 64 hex characters\n/],
    ['no-paths', (pack) => { pack.proof = null; const second = pack.receipts[1] as { secretsAccessed: boolean; paths?: string[] }; second.secretsAccessed = true; delete second.paths; }, /^FAIL format at step 2: receipt paths is not a list of strings\n/],
    ['null-receipt', (pack) => { pack.receipts.push(null); }, /^FAIL format at step 15: receipt is not an object\n/],
  ];
  for (const [name, edit, expected] of variants) {
    const pack = JSON.parse(readFileSync(PASS_PACK, 'utf8'));
    edit(pack);
    const file = join(dir, `${name}.json`);
    writeFileSync(file, JSON.stringify(pack, null, 2));
    const result = runScript('packages/verify/src/bin.ts', dir, [file, '--expect-policy', 'no-secrets-read/v1'], { BLACKBOX_PUBLIC_KEY: undefined });
    assert.equal(result.code, 1, `${name}: ${result.out}`);
    assert.match(result.out, expected, name);
    assert.doesNotMatch(result.out, /\n\s+at |TypeError|RangeError|SyntaxError/, `${name}: stack trace`);
  }
});
