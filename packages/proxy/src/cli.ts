import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defaultSecretPolicy, discloseStep, merkleRoot, proveProperty, verifyChain, verifyPropertyProof, type PropertyFailure, type PropertyProof, type SecretPolicy } from '@blackbox/receipts';
import { loadReceipts, loadWitnesses, signingKeys, dataDir } from './store.js';

const [command = 'verify', ...rest] = process.argv.slice(2);
const option = (name: string) => { const index = rest.indexOf(`--${name}`); return index >= 0 ? rest[index + 1] : undefined; };
const positional = rest.filter((item, index) => !item.startsWith('--') && !rest[index - 1]?.startsWith('--'));
const defaultProofFile = resolve(dataDir, 'proof-no-secrets.json');

function fail(result: PropertyFailure) {
  console.log(`FAIL no-secrets-read${result.step === null ? '' : ` at step ${result.step}`}: ${result.reason}`);
  process.exitCode = 1;
}

async function loadPolicy(): Promise<SecretPolicy> {
  const file = option('policy');
  return file ? JSON.parse(await readFile(resolve(file), 'utf8')) as SecretPolicy : defaultSecretPolicy;
}

if (command === 'verify') {
  const receipts = await loadReceipts();
  const keys = await signingKeys();
  const result = receipts.length ? verifyChain(receipts, keys.publicKey) : { valid: false, brokenAt: null, reason: 'No receipts exist for this session' };
  const root = merkleRoot(receipts.map(({ hash }) => hash));
  console.log(JSON.stringify({ ...result, receipts: receipts.length, root, sessionId: receipts[0]?.sessionId ?? null }, null, 2));
  if (!result.valid) process.exitCode = 1;
} else if (command === 'prove' || command === 'prove-no-secrets') {
  const [receipts, witnesses, keys, policy] = await Promise.all([loadReceipts(), loadWitnesses(), signingKeys(), loadPolicy()]);
  const result = proveProperty(receipts, witnesses, policy, keys);
  if (!result.valid) fail(result);
  else {
    // Check the bundle the same way a third party would, from the public key alone.
    const check = verifyPropertyProof(result.proof, keys.publicKey);
    if (!check.valid) fail(check);
    else {
      const out = resolve(option('out') ?? defaultProofFile);
      await writeFile(out, `${JSON.stringify(result.proof, null, 2)}\n`);
      console.log(`PASS no-secrets-read: ${check.steps}/${result.proof.receiptCount} receipts satisfy policy ${policy.id} (${check.policyHash.slice(0, 12)})`);
      console.log(`root ${check.root}`);
      console.log(`proof written to ${out} (inclusion paths and commitments only; no raw arguments)`);
    }
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
  const receipts = await loadReceipts();
  if (!receipts.length) throw new Error('No receipts exist to tamper with');
  const file = resolve(dataDir, 'session.jsonl');
  const lines = (await readFile(file, 'utf8')).trim().split('\n');
  const entry = JSON.parse(lines[0]);
  entry.tool = `${entry.tool}-edited`;
  lines[0] = JSON.stringify(entry);
  await writeFile(file, `${lines.join('\n')}\n`);
  console.log(`Edited receipt 1 in ${file}`);
} else {
  console.error('Usage: blackbox-receipts [verify | prove [--policy file] [--out file] | verify-proof [file] [--root hex] [--public-key file] | disclose <step> | tamper]');
  process.exitCode = 2;
}
