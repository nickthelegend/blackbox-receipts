#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createSeal, signDigest, parsePack, PACK_FORMAT, PUBLISHED_POLICIES, publishedPolicy, verifyPack, type Pack, DEFAULT_POLICY_HASH, defaultSecretPolicy, discloseStep, policyHash, merkleRoot, verifyChain, verifyPropertyProof, verifySeal, type PropertyFailure, type PropertyProof, type Receipt, type Seal, type SecretPolicy } from '@blackbox/receipts';
import { renderExplanation, renderStep } from './explain.js';
import { narrate, renderNarrative, type Narrative } from './narrate.js';
import { failLine as formatFailLine, explainCurrent, policyTag as tagFor, proveCurrent as proveWith } from './report.js';
import { attestationDigest, checkDiff, headOf, junit, type DiffAttestation } from './attest.js';
import { CorruptLogError, loadReceipts, loadSeal, loadWitnesses, parseJsonLines, restoreSession, signingKeys, tamperReceipt, dataDir } from './store.js';

const [command = 'verify', ...rest] = process.argv.slice(2);
const option = (name: string) => { const index = rest.indexOf(`--${name}`); return index >= 0 ? rest[index + 1] : undefined; };
const positional = rest.filter((item, index) => !item.startsWith('--') && !rest[index - 1]?.startsWith('--'));
const defaultProofFile = resolve(dataDir, 'proof-no-secrets.json');

// The policy a verdict is judged against. Verifiers pin no-secrets-read/v2 unless told otherwise with
// --expect-policy <published id | policy file> or BLACKBOX_POLICY_HASH; proofs made under any other
// policy fail. Runs recorded under v1 verify with --expect-policy no-secrets-read/v1.
async function loadPinnedPolicy(): Promise<{ id: string; hash: string }> {
  const value = option('expect-policy');
  if (value) {
    const published = publishedPolicy(value);
    if (published) return { id: published.id, hash: policyHash(published) };
    let policy: SecretPolicy;
    try { policy = JSON.parse(await readFile(resolve(value), 'utf8')) as SecretPolicy; } catch {
      console.error(`--expect-policy ${value} is neither a published policy (${PUBLISHED_POLICIES.map(({ id }) => id).join(', ')}) nor a readable policy file`);
      process.exit(2);
    }
    return { id: policy.id, hash: policyHash(policy) };
  }
  const hash = process.env.BLACKBOX_POLICY_HASH?.trim();
  if (hash && hash !== DEFAULT_POLICY_HASH) return { id: publishedPolicy(hash)?.id ?? 'pinned-by-hash', hash };
  return { id: defaultSecretPolicy.id, hash: DEFAULT_POLICY_HASH };
}
const pinned = await loadPinnedPolicy();
const policyTag = tagFor(pinned);

const failLine = (result: PropertyFailure) => formatFailLine(result, pinned);

function fail(result: PropertyFailure) {
  console.log(failLine(result));
  process.exitCode = 1;
}

/** Proves the current session and checks the bundle the way a third party would, from the public key alone. */
const proveCurrent = async () => proveWith(await loadPolicy(), pinned);

/** The receipts of an exported session directory (receipts/<session>/session.jsonl). */
const readExportLog = async (dir: string) => parseJsonLines<Receipt>(await readFile(join(dir, 'session.jsonl'), 'utf8'), 'session.jsonl');

/** Checks an exported session directory using only the files in it (no private key, no raw arguments). */
async function verifyExport(dir: string): Promise<string> {
  const name = relative(process.cwd(), dir) || dir;
  const failure = (reason: string, step: number | null = null) => `${failLine({ valid: false, step, reason })} [${name}]`;
  let receipts: Receipt[];
  let publicKey: string;
  try {
    receipts = await readExportLog(dir);
    publicKey = await readFile(join(dir, 'public-key.pem'), 'utf8');
  } catch (error) { return failure(error instanceof CorruptLogError ? error.message : `Cannot read export: ${error instanceof Error ? error.message : String(error)}`); }
  const pinnedKey = process.env.BLACKBOX_PUBLIC_KEY;
  if (pinnedKey && pinnedKey.trim() !== publicKey.trim()) return failure('Exported public key does not match the pinned BLACKBOX_PUBLIC_KEY');
  if (!receipts.length) return failure('No receipts exist for this session, so there is nothing to prove');
  const chain = verifyChain(receipts, publicKey);
  if (!chain.valid) return failure(`Chain verification failed: ${chain.reason}`, chain.brokenAt);
  let seal: Seal | null = null;
  try { seal = JSON.parse(await readFile(join(dir, 'seal.json'), 'utf8')) as Seal; } catch { seal = null; }
  const sealed = verifySeal(seal, receipts, publicKey, 'exact');
  if (!sealed.valid) return failure(sealed.reason!);
  if (!existsSync(join(dir, 'proof-no-secrets.json'))) {
    const reported = existsSync(join(dir, 'result.txt')) ? (await readFile(join(dir, 'result.txt'), 'utf8')).trim() : 'no result recorded';
    return failure(`Chain intact and seal matches, but the export has no property proof. Prover reported: ${reported}`);
  }
  const proof = JSON.parse(await readFile(join(dir, 'proof-no-secrets.json'), 'utf8')) as PropertyProof;
  if (proof.sessionId !== receipts[0].sessionId) return failure('Proof belongs to a different session');
  const root = merkleRoot(receipts.map(({ hash }) => hash));
  const check = verifyPropertyProof(proof, publicKey, root, pinned.hash);
  if (!check.valid) return `${failLine(check)} [${name}]`;
  return `PASS no-secrets-read ${policyTag}: ${check.steps} receipts, chain intact, seal matches, proof verified under root ${root} [${name}]`;
}

async function loadPolicy(): Promise<SecretPolicy> {
  const file = option('policy');
  return file ? JSON.parse(await readFile(resolve(file), 'utf8')) as SecretPolicy : defaultSecretPolicy;
}

// A log line that is not one JSON record (an append cut short by a killed process, or an edit) is a
// located FAIL in each command's own format, never a stack trace.
try {
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
    // Without arguments: every receipts/<session>/ holding a session.jsonl (nested folders such as
    // receipts/agent-demo/ are checked by naming them explicitly).
    const dirs = positional.length ? positional.map((dir) => resolve(dir)) : existsSync(base) ? (await readdir(base, { withFileTypes: true })).filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, 'session.jsonl'))).map((entry) => join(base, entry.name)) : [];
    if (!dirs.length) { console.log(`FAIL no-secrets-read ${policyTag}: no exported sessions found under receipts/`); process.exitCode = 1; }
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
    const result = verifyPropertyProof(proof, publicKey, option('root'), pinned.hash);
    if (!result.valid) fail(result);
    else console.log(`PASS no-secrets-read ${policyTag}: ${result.steps} receipts proven under root ${result.root}`);
  } else if (command === 'disclose') {
    const step = Number(positional[0]);
    if (!Number.isInteger(step) || step < 1) throw new Error('Usage: blackbox-receipts disclose <step>');
    const [receipts, witnesses, keys, policy] = await Promise.all([loadReceipts(), loadWitnesses(), signingKeys(), loadPolicy()]);
    console.log(JSON.stringify(discloseStep(receipts, witnesses, step, policy, keys.privateKey), null, 2));
  } else if (command === 'explain') {
    // Step-cited explanation for a reviewer: the prover's verdict, then what each step did and why.
    //   explain [--json] [--step N] [--out file] [--model meterless [--routing meterless/auto]]
    const model = await explainCurrent(await loadPolicy(), pinned);
    const step = option('step');
    if (step !== undefined && !(Number.isInteger(Number(step)) && Number(step) >= 1)) { console.error(`explain --step takes a step number, got "${step}"`); process.exit(2); }
    // --model meterless (or BLACKBOX_EXPLAIN_MODEL=meterless): add a narrative written by the local Meterless
    // Runtime from the explanation above. Missing configuration or an offline runtime is "Setup required".
    const narrator = option('model') ?? process.env.BLACKBOX_EXPLAIN_MODEL;
    let narrative: Narrative | null = null;
    if (narrator) {
      if (narrator !== 'meterless') { console.error(`explain --model supports only "meterless", got "${narrator}"`); process.exit(2); }
      const { MeterlessClient, MeterlessConfigError, meterlessConfigFromEnv } = await import('@blackbox/meterless');
      let client: InstanceType<typeof MeterlessClient>;
      try { client = new MeterlessClient(meterlessConfigFromEnv()); } catch (error) {
        if (error instanceof MeterlessConfigError) { console.error(`Setup required: ${error.message}`); process.exit(2); }
        throw error;
      }
      const status = await client.status();
      if (status === 'offline') { console.error(`Setup required: the Meterless Runtime is not reachable at ${client.config.baseUrl} (GET /models). Install and start it (see README, "Meterless"), or unset --model.`); process.exit(2); }
      if (status === 'unauthorized') { console.error(`FAIL: the Meterless Runtime at ${client.config.baseUrl} rejected the token (401/403).`); process.exit(1); }
      narrative = await narrate(model, client, option('routing') ?? 'meterless/auto');
    }
    const text = rest.includes('--json') ? `${JSON.stringify(step ? model.steps.find((item) => item.step === Number(step)) ?? null : narrative ? { ...model, narrative } : model, null, 2)}\n` : step ? renderStep(model, Number(step)) : renderExplanation(model) + (narrative ? renderNarrative(narrative) : '');
    if (option('out')) await writeFile(resolve(option('out')!), text);
    process.stdout.write(text);
    if (step && !model.steps.some((item) => item.step === Number(step))) process.exitCode = 1;
  } else if (command === 'pack') {
    // One JSON file a third party can check offline (CLI verify-pack, or the dashboard's /verify page):
    // receipts, public key, seal, proof (on PASS) and the verdict. No private key, no raw arguments.
    const from = option('from');
    let pack: Pack;
    if (from) {
      const dir = resolve(from);
      const read = (file: string) => readFile(join(dir, file), 'utf8');
      const receipts = await readExportLog(dir);
      const optional = async (file: string) => (existsSync(join(dir, file)) ? read(file) : null);
      const [publicKey, seal, proof, verdict] = await Promise.all([read('public-key.pem'), optional('seal.json'), optional('proof-no-secrets.json'), optional('result.txt')]);
      pack = { format: PACK_FORMAT, createdAt: new Date().toISOString(), sessionId: receipts[0]?.sessionId ?? '', publicKey, receipts, seal: seal ? JSON.parse(seal) as Seal : null, proof: proof ? JSON.parse(proof) as PropertyProof : null, verdict: verdict?.trim() ?? '' };
    } else {
      const { line, proof, receipts, publicKey, privateKey } = await proveCurrent();
      if (!receipts.length) { console.log(line); process.exit(1); }
      pack = { format: PACK_FORMAT, createdAt: new Date().toISOString(), sessionId: receipts[0].sessionId, publicKey, receipts, seal: createSeal(receipts, privateKey), proof, verdict: line };
    }
    const out = resolve(positional[0] ?? `blackbox-pack-${pack.sessionId.slice(0, 8)}.json`);
    await writeFile(out, `${JSON.stringify(pack, null, 2)}\n`);
    const check = verifyPack(pack, { expectedPolicyHash: pinned.hash, expectedPolicyId: pinned.id });
    console.log(check.headline);
    console.log(`pack written to ${relative(process.cwd(), out) || out} (${pack.receipts.length} receipts; no private key, no raw arguments)`);
  } else if (command === 'verify-pack') {
    // Same checks the browser verifier runs (@blackbox/verify), from the pack file alone.
    const file = resolve(positional[0] ?? '');
    let pack: Pack;
    try { pack = parsePack(await readFile(file, 'utf8')); } catch (error) { console.log(`FAIL: cannot read pack ${positional[0] ?? '(none given)'}: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); }
    const check = verifyPack(pack, { expectedPolicyHash: pinned.hash, expectedPolicyId: pinned.id, pinnedPublicKey: process.env.BLACKBOX_PUBLIC_KEY });
    console.log(check.headline);
    for (const item of check.checks) console.log(`  ${item.ok ? 'ok  ' : 'FAIL'} ${item.name}: ${item.detail}`);
    if (!check.ok) process.exitCode = 1;
  } else if (command === 'attest-diff') {
    // Receipt-gated merge: fail any changed file that a signed write_file step did not produce.
    //   attest-diff --base <sha> [--from <exportDir>] [--junit out.xml] [--out attestation.json] [--ignore path/**]
    const base = option('base');
    if (!base) { console.error('Usage: blackbox-receipts attest-diff --base <sha> [--from exportDir] [--junit out.xml] [--out attestation.json] [--ignore glob]'); process.exit(2); }
    const from = option('from');
    let receipts: Receipt[];
    let publicKey: string;
    let integrity: string | null = null;
    if (from) {
      const dir = resolve(from);
      receipts = await readExportLog(dir);
      publicKey = await readFile(join(dir, 'public-key.pem'), 'utf8');
      const seal = existsSync(join(dir, 'seal.json')) ? JSON.parse(await readFile(join(dir, 'seal.json'), 'utf8')) as Seal : null;
      const sealed = verifySeal(seal, receipts, publicKey, 'exact');
      if (!sealed.valid) integrity = sealed.reason;
      if (process.env.BLACKBOX_PUBLIC_KEY && process.env.BLACKBOX_PUBLIC_KEY.trim() !== publicKey.trim()) integrity = 'Export public key does not match the pinned BLACKBOX_PUBLIC_KEY';
    } else {
      receipts = await loadReceipts();
      publicKey = (await signingKeys()).publicKey;
      const seal = await loadSeal();
      if (seal) { const sealed = verifySeal(seal, receipts, publicKey, 'prefix'); if (!sealed.valid) integrity = sealed.reason; }
    }
    const chain = verifyChain(receipts, publicKey);
    if (!chain.valid) integrity = `Chain verification failed at step ${chain.brokenAt}: ${chain.reason}`;
    if (!receipts.length) integrity = 'No receipts exist for this session';
    // The exported receipts themselves and the local store are part of the change set by design.
    // So are this command's own outputs.
    const outputs = [option('junit'), option('out')].filter((file): file is string => Boolean(file)).map((file) => relative(process.cwd(), resolve(file)).split(sep).join('/'));
    const ignore = ['receipts/**', '.blackbox/**', ...outputs, ...rest.filter((item, index) => rest[index - 1] === '--ignore')];
    const files = integrity ? [] : checkDiff(process.cwd(), base, receipts, ignore);
    const ok = !integrity && files.every((file) => file.ok);
    const sessionId = receipts[0]?.sessionId ?? 'none';
    for (const file of files) console.log(file.ok ? `ok   ${file.path}: ${file.reason}` : `FAIL ${file.reason}`);
    const unrecorded = files.filter((file) => !file.ok).length;
    console.log(integrity ? `FAIL attest-diff: ${integrity}` : ok ? `PASS attest-diff: ${files.length} changed file(s) since ${base.slice(0, 12)}, each produced by a signed write_file step` : `FAIL attest-diff: ${unrecorded} of ${files.length} changed file(s) since ${base.slice(0, 12)} were not produced by a signed write_file step`);
    if (option('junit')) await writeFile(resolve(option('junit')!), junit(integrity ? [{ path: '(receipts)', change: 'modified', blob: null, step: null, ok: false, reason: integrity }] : files, base, sessionId));
    if (option('out')) {
      const keys = await signingKeys();
      const unsigned: Omit<DiffAttestation, 'signature'> = { kind: 'blackbox-diff-attestation', version: 1, base, head: headOf(process.cwd()), sessionId, root: merkleRoot(receipts.map(({ hash }) => hash)), files, ok, createdAt: new Date().toISOString(), publicKey: keys.publicKey };
      await writeFile(resolve(option('out')!), `${JSON.stringify({ ...unsigned, signature: signDigest(attestationDigest(unsigned), keys.privateKey) }, null, 2)}\n`);
    }
    if (!ok) process.exitCode = 1;
  } else if (command === 'public-key') {
    // The key that verifies this proxy's receipts. Safe to publish; the private key never leaves the key dir.
    process.stdout.write((await signingKeys()).publicKey);
  } else if (command === 'tamper') {
    const step = Number(positional[0] ?? 1);
    if (!Number.isInteger(step) || step < 1) throw new Error(`tamper takes a block step number, got "${positional[0]}"`);
    console.log(`Edited block ${await tamperReceipt(step)} in ${resolve(dataDir, 'session.jsonl')}. Undo with: restore`);
  } else if (command === 'restore') {
    console.log(`Restored block(s) ${(await restoreSession()).join(', ')} to their signed originals.`);
  } else {
    console.error('Usage: blackbox-receipts [verify | prove [--policy file] [--out file] | verify-proof [file] [--root hex] [--public-key file] | export [dir] | verify-export [dir...] | explain [--json] [--step N] [--out file] [--model meterless] | pack [out.json] [--from exportDir] | verify-pack <file> | attest-diff --base <sha> [--from dir] [--junit file] [--out file] | disclose <step> | public-key | tamper [step] | restore]\nVerdicts are judged against no-secrets-read/v2 unless you pin another policy with --expect-policy <id or file> (no-secrets-read/v1 for runs recorded under it) or BLACKBOX_POLICY_HASH.');
    process.exitCode = 2;
  }
} catch (error) {
  if (!(error instanceof CorruptLogError)) throw error;
  if (command === 'verify') console.log(JSON.stringify({ valid: false, brokenAt: error.line, reason: error.message, corruptLine: error.line, receipts: null, root: null, sessionId: null, seal: 'not checked' }, null, 2));
  else if (command === 'attest-diff') console.log(`FAIL attest-diff: ${error.message}`);
  else if (rest.includes('--json')) console.log(JSON.stringify({ error: error.message, corruptLine: error.line }, null, 2));
  else if (['explain', 'disclose', 'tamper', 'restore'].includes(command)) console.log(`FAIL: ${error.message}`);
  else console.log(`FAIL no-secrets-read ${policyTag}: ${error.message}`);
  process.exitCode = 1;
}
