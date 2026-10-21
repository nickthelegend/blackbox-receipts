import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createSeal, defaultSecretPolicy, discloseStep, merkleRoot, proveProperty, verifyChain, verifyPropertyProof, verifySeal, type PropertyFailure, type PropertyProof, type Receipt, type Seal, type SecretPolicy } from '@blackbox/receipts';
import { loadReceipts, loadSeal, loadWitnesses, restoreSession, signingKeys, tamperReceipt, dataDir } from './store.js';

const [command = 'verify', ...rest] = process.argv.slice(2);
const option = (name: string) => { const index = rest.indexOf(`--${name}`); return index >= 0 ? rest[index + 1] : undefined; };
const positional = rest.filter((item, index) => !item.startsWith('--') && !rest[index - 1]?.startsWith('--'));
const defaultProofFile = resolve(dataDir, 'proof-no-secrets.json');

function failLine(result: PropertyFailure) {
  return `FAIL no-secrets-read${result.step === null ? '' : ` at step ${result.step}`}: ${result.reason}`;
}

function fail(result: PropertyFailure) {
  console.log(failLine(result));
  process.exitCode = 1;
}

/** Proves the current session and checks the bundle the way a third party would, from the public key alone. */
async function proveCurrent(): Promise<{ line: string; proof: PropertyProof | null; receipts: Receipt[]; publicKey: string; privateKey: string }> {
  const [receipts, witnesses, keys, policy, seal] = await Promise.all([loadReceipts(), loadWitnesses(), signingKeys(), loadPolicy(), loadSeal()]);
  // The proxy's last seal must still hold: the log may have grown since, but nothing sealed may be gone.
  // Checked once the chain itself holds, so an edited receipt is still reported at its own step.
  const sealed = seal && verifyChain(receipts, keys.publicKey).valid ? verifySeal(seal, receipts, keys.publicKey, 'prefix') : null;
  if (sealed && !sealed.valid) return { line: failLine({ valid: false, step: null, reason: sealed.reason! }), proof: null, receipts, publicKey: keys.publicKey, privateKey: keys.privateKey };
  const result = proveProperty(receipts, witnesses, policy, keys);
  if (!result.valid) return { line: failLine(result), proof: null, receipts, publicKey: keys.publicKey, privateKey: keys.privateKey };
  const check = verifyPropertyProof(result.proof, keys.publicKey);
  if (!check.valid) return { line: failLine(check), proof: null, receipts, publicKey: keys.publicKey, privateKey: keys.privateKey };
  return { line: `PASS no-secrets-read: ${check.steps}/${result.proof.receiptCount} receipts satisfy policy ${policy.id} (${check.policyHash.slice(0, 12)})`, proof: result.proof, receipts, publicKey: keys.publicKey, privateKey: keys.privateKey };
}

/** Checks an exported session directory using only the files in it (no private key, no raw arguments). */
async function verifyExport(dir: string): Promise<string> {
  const name = relative(process.cwd(), dir) || dir;
  const failure = (reason: string, step: number | null = null) => `${failLine({ valid: false, step, reason })} [${name}]`;
  let receipts: Receipt[];
  let publicKey: string;
  try {
    receipts = (await readFile(join(dir, 'session.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Receipt);
    publicKey = await readFile(join(dir, 'public-key.pem'), 'utf8');
  } catch (error) { return failure(`Cannot read export: ${error instanceof Error ? error.message : String(error)}`); }
  const pinned = process.env.BLACKBOX_PUBLIC_KEY;
  if (pinned && pinned.trim() !== publicKey.trim()) return failure('Exported public key does not match the pinned BLACKBOX_PUBLIC_KEY');
  if (!receipts.length) return failure('No receipts exist for this session, so there is nothing to prove');
  const chain = verifyChain(receipts, publicKey);
  if (!chain.valid) return failure(`Chain verification failed: ${chain.reason}`, chain.brokenAt);
  let seal: Seal | null = null;
  try { seal = JSON.parse(await readFile(join(dir, 'seal.json'), 'utf8')) as Seal; } catch { seal = null; }
  const sealed = verifySeal(seal, receipts, publicKey, 'exact');
  if (!sealed.valid) return failure(sealed.reason!);
  if (!existsSync(join(dir, 'proof-no-secrets.json'))) {
    const reported = existsSync(join(dir, 'result.txt')) ? (await readFile(join(dir, 'result.txt'), 'utf8')).trim() : 'no result recorded';
    return failure(`Export has no property proof. Prover reported: ${reported}`);
  }
  const proof = JSON.parse(await readFile(join(dir, 'proof-no-secrets.json'), 'utf8')) as PropertyProof;
  if (proof.sessionId !== receipts[0].sessionId) return failure('Proof belongs to a different session');
  const root = merkleRoot(receipts.map(({ hash }) => hash));
  const check = verifyPropertyProof(proof, publicKey, root);
  if (!check.valid) return `${failLine(check)} [${name}]`;
  return `PASS no-secrets-read: ${check.steps} receipts, chain intact, seal matches, proof verified under root ${root} [${name}]`;
}

async function loadPolicy(): Promise<SecretPolicy> {
  const file = option('policy');
  return file ? JSON.parse(await readFile(resolve(file), 'utf8')) as SecretPolicy : defaultSecretPolicy;
}

if (command === 'verify') {
  const receipts = await loadReceipts();
  const keys = await signingKeys();
  const seal = await loadSeal();
  let result = receipts.length ? verifyChain(receipts, keys.publicKey) : { valid: false, brokenAt: null, reason: 'No receipts exist for this session' };
  const sealed = seal ? verifySeal(seal, receipts, keys.publicKey, 'prefix') : null;
  if (result.valid && sealed && !sealed.valid) result = { valid: false, brokenAt: null, reason: sealed.reason };
  const root = merkleRoot(receipts.map(({ hash }) => hash));
  const sealStatus = !seal ? 'none yet (written when the proxy shuts down)' : sealed!.valid ? `covers ${seal.count} of ${receipts.length} receipts` : 'BROKEN';
  console.log(JSON.stringify({ ...result, receipts: receipts.length, root, sessionId: receipts[0]?.sessionId ?? null, seal: sealStatus }, null, 2));
  if (!result.valid) process.exitCode = 1;
} else if (command === 'prove' || command === 'prove-no-secrets') {
  const { line, proof } = await proveCurrent();
  console.log(line);
  if (!proof) process.exitCode = 1;
  else {
    const out = resolve(option('out') ?? defaultProofFile);
    await writeFile(out, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`root ${proof.root}`);
    console.log(`proof written to ${out} (inclusion paths and commitments only; no raw arguments)`);
  }
} else if (command === 'export') {
  // Publishable record of a session: signed receipts, the public key, the proof (on PASS) and the
  // prover's verdict, plus a signed seal of its length. The signing key and raw arguments (witness) are never exported.
  const { line, proof, receipts, publicKey, privateKey } = await proveCurrent();
  const out = resolve(positional[0] ?? join('receipts', receipts[0]?.sessionId ?? 'empty-session'));
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'session.jsonl'), receipts.map((receipt) => `${JSON.stringify(receipt)}\n`).join(''));
  await writeFile(join(out, 'public-key.pem'), publicKey);
  await writeFile(join(out, 'result.txt'), `${line}\n`);
  if (receipts.length) await writeFile(join(out, 'seal.json'), `${JSON.stringify(createSeal(receipts, privateKey), null, 2)}\n`);
  if (proof) await writeFile(join(out, 'proof-no-secrets.json'), `${JSON.stringify(proof, null, 2)}\n`);
  console.log(line);
  console.log(`exported ${receipts.length} receipts to ${relative(process.cwd(), out) || out}`);
  if (!proof) process.exitCode = 1;
} else if (command === 'verify-export') {
  const base = resolve('receipts');
  const dirs = positional.length ? positional.map((dir) => resolve(dir)) : existsSync(base) ? (await readdir(base, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => join(base, entry.name)) : [];
  if (!dirs.length) { console.log('FAIL no-secrets-read: no exported sessions found under receipts/'); process.exitCode = 1; }
  for (const dir of dirs) {
    const line = await verifyExport(dir);
    console.log(line);
    if (line.startsWith('FAIL')) process.exitCode = 1;
  }
} else if (command === 'verify-proof') {
  const file = resolve(positional[0] ?? defaultProofFile);
  const publicKey = option('public-key') ? await readFile(resolve(option('public-key')!), 'utf8') : (await signingKeys()).publicKey;
  let proof: PropertyProof;
  try { proof = JSON.parse(await readFile(file, 'utf8')); } catch (error) { fail({ valid: false, step: null, reason: `Cannot read proof ${file}: ${error instanceof Error ? error.message : String(error)}` }); process.exit(); }
  const result = verifyPropertyProof(proof, publicKey, option('root'));
  if (!result.valid) fail(result);
  else console.log(`PASS no-secrets-read: ${result.steps} receipts proven under root ${result.root}`);
} else if (command === 'disclose') {
  const step = Number(positional[0]);
  if (!Number.isInteger(step) || step < 1) throw new Error('Usage: blackbox-receipts disclose <step>');
  const [receipts, witnesses, keys, policy] = await Promise.all([loadReceipts(), loadWitnesses(), signingKeys(), loadPolicy()]);
  console.log(JSON.stringify(discloseStep(receipts, witnesses, step, policy, keys.privateKey), null, 2));
} else if (command === 'tamper') {
  const step = Number(positional[0] ?? 1);
  if (!Number.isInteger(step) || step < 1) throw new Error(`tamper takes a block step number, got "${positional[0]}"`);
  console.log(`Edited block ${await tamperReceipt(step)} in ${resolve(dataDir, 'session.jsonl')}. Undo with: restore`);
} else if (command === 'restore') {
  console.log(`Restored block(s) ${(await restoreSession()).join(', ')} to their signed originals.`);
} else {
  console.error('Usage: blackbox-receipts [verify | prove [--policy file] [--out file] | verify-proof [file] [--root hex] [--public-key file] | export [dir] | verify-export [dir...] | disclose <step> | tamper [step] | restore]');
  process.exitCode = 2;
}
