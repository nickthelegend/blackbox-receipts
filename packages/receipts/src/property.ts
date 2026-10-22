import { createPrivateKey, sign } from 'node:crypto';
import { homedir } from 'node:os';
import { merkleProof, merkleRoot, policyHash, proofStatement, stableJson, verifyChain, verifyPropertyProof, DEFAULT_POLICY_HASH, NO_SECRETS_PROPERTY, type PropertyFailure, type PropertyProof, type Receipt, type SecretPolicy, type VerifyPropertyResult } from '@blackbox/verify';
import { argsMatch, sha256, signDigest } from './index.js';

// Selective-disclosure property proofs.
//
// The prover holds the full receipt chain plus the raw tool arguments (the witness). It evaluates a
// policy over every step and publishes only: each receipt's leaf hash and proxy signature, a Merkle
// inclusion path to the session root, and a salted per-step property commitment. Raw args, paths and
// results stay private. Any single step can later be opened with `discloseStep` and checked with
// `verifyDisclosure` without revealing the others. Proofs are verified by @blackbox/verify.
//
// Trust model: the policy evaluation is attested by the proxy key, the same key that signed the
// receipts. This is not a zero-knowledge proof of the predicate; a Noir circuit would remove that trust.

/** Raw arguments for one step and the salt of its argsHash, kept privately next to the receipt log. */
export type Witness = { sessionId: string; step: number; args: unknown; salt?: string; detail?: string };

export type ProveResult = { valid: true; proof: PropertyProof } | PropertyFailure;
export type Disclosure = { step: number; receipt: Receipt; args: unknown; argsSalt?: string; salt: string };

function globToRegExp(glob: string): RegExp {
  const home = glob.startsWith('~/');
  const body = home ? glob.slice(2) : glob;
  let source = '';
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === '*' && body[index + 1] === '*') {
      if (body[index + 2] === '/') { source += '(?:.*/)?'; index += 2; } else { source += '.*'; index += 1; }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // Case-insensitive: macOS and Windows disks open `.ENV` as `.env`, and an upstream server's paths are
  // never resolved to their on-disk case, so a case variant must match the glob it spells.
  return new RegExp(home ? `^~/${source}$` : `(?:^|/)${source}$`, 'i');
}

function normalizePath(candidate: string): string {
  let value = candidate.trim().replaceAll('\\', '/');
  const home = homedir().replaceAll('\\', '/');
  if (value === home || value.startsWith(`${home}/`)) value = `~${value.slice(home.length)}`;
  if (value.startsWith('$HOME/')) value = `~${value.slice(5)}`;
  while (value.startsWith('./')) value = value.slice(2);
  return value.replace(/\/+$/, '');
}

function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, into));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, into));
  return into;
}

/** Every string that could name a path: the recorded paths, each argument, its shell tokens and the path part of `rev:path`. */
function pathCandidates(paths: string[], args: unknown): string[] {
  const candidates = new Set<string>(paths);
  for (const text of collectStrings(args)) {
    for (const token of (text.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((item) => item.replace(/^["']|["']$/g, ''))) {
      candidates.add(token);
      if (token.includes(':')) candidates.add(token.split(':').at(-1)!);
      if (token.includes('=')) candidates.add(token.split('=').at(-1)!);
    }
  }
  return [...candidates].map(normalizePath).filter(Boolean);
}

/**
 * Returns why a call violates the policy, or null. The proxy runs this before a call executes (and
 * denies it), and the prover runs it again over the recorded receipt, so the two can't disagree.
 */
export function evaluateCall(tool: string, paths: string[], args: unknown, policy: SecretPolicy): string | null {
  const globs = policy.secretPathGlobs.map((glob) => ({ glob, regex: globToRegExp(glob) }));
  for (const candidate of pathCandidates(paths, args)) {
    const hit = globs.find(({ regex }) => regex.test(candidate));
    if (hit) return `${tool} touched secret path matching "${hit.glob}"`;
  }
  const strings = collectStrings(args);
  for (const { name, pattern } of policy.secretArgPatterns) {
    if (strings.some((text) => new RegExp(pattern).test(text))) return `${tool} arguments match secret pattern "${name}"`;
  }
  return null;
}

/** Returns why a recorded step violates the policy, or null when it satisfies it. */
export function evaluateStep(receipt: Receipt, args: unknown, policy: SecretPolicy): string | null {
  const violation = evaluateCall(receipt.tool, receipt.paths, args, policy);
  if (violation) return violation;
  if (receipt.secretsAccessed) return `${receipt.tool} was flagged by the proxy for secret access`;
  return null;
}

function stepSalt(privateKeyPem: string, digest: string, leaf: string): string {
  // Ed25519 signatures are deterministic, so the prover can re-derive any salt to open a step later.
  return sha256(sign(null, Buffer.from(`blackbox-salt|${digest}|${leaf}`), createPrivateKey(privateKeyPem)));
}

function commitmentFor(digest: string, step: number, leaf: string, argsHash: string, salt: string): string {
  return sha256(stableJson({ property: NO_SECRETS_PROPERTY, policyHash: digest, step, leaf, argsHash, verdict: 'pass', salt }));
}

/**
 * The witness that opens this receipt's argsHash. A proxy killed between appending a witness and its
 * receipt leaves an orphan line with the same step number as the next real call, so the first match is
 * not enough: prefer the one whose args and salt open the signed hash, else the last one for that step.
 */
export function witnessFor(witnesses: Witness[], receipt: Receipt): Witness | undefined {
  const candidates = witnesses.filter((item) => item.sessionId === receipt.sessionId && item.step === receipt.step);
  return candidates.find((item) => argsMatch(receipt.argsHash, item.args, item.salt)) ?? candidates.at(-1);
}

/** Checks the chain, evaluates the policy on every step and returns a shareable proof or the first failing step. */
export function proveProperty(receipts: Receipt[], witnesses: Witness[], policy: SecretPolicy, keys: { privateKey: string; publicKey: string }): ProveResult {
  if (receipts.length === 0) return { valid: false, step: null, reason: 'No receipts exist for this session, so there is nothing to prove' };
  const chain = verifyChain(receipts, keys.publicKey);
  if (!chain.valid) return { valid: false, step: chain.brokenAt, reason: `Chain verification failed: ${chain.reason}` };
  for (const receipt of receipts) {
    const witness = witnessFor(witnesses, receipt);
    if (!witness) return { valid: false, step: receipt.step, reason: 'Raw arguments for this step are missing, so the policy cannot be evaluated' };
    if (!argsMatch(receipt.argsHash, witness.args, witness.salt)) return { valid: false, step: receipt.step, reason: 'Stored arguments do not match the signed argsHash' };
    const violation = evaluateStep(receipt, witness.args, policy);
    if (violation) return { valid: false, step: receipt.step, reason: violation };
  }
  const digest = policyHash(policy);
  const leaves = receipts.map(({ hash }) => hash);
  const steps = receipts.map((receipt, index) => ({
    step: receipt.step,
    leaf: receipt.hash,
    signature: receipt.signature,
    inclusion: merkleProof(leaves, index).path,
    commitment: commitmentFor(digest, receipt.step, receipt.hash, receipt.argsHash, stepSalt(keys.privateKey, digest, receipt.hash)),
  }));
  const unsigned = { version: 1 as const, property: NO_SECRETS_PROPERTY, policy, policyHash: digest, sessionId: receipts[0].sessionId, root: merkleRoot(leaves), receiptCount: receipts.length, steps };
  return { valid: true, proof: { ...unsigned, attestation: signDigest(proofStatement(unsigned), keys.privateKey) } };
}

/** Opens one step's commitment for an auditor, revealing only that step's receipt and arguments. */
export function discloseStep(receipts: Receipt[], witnesses: Witness[], step: number, policy: SecretPolicy, privateKeyPem: string): Disclosure {
  const receipt = receipts.find((item) => item.step === step);
  const witness = receipt && witnessFor(witnesses, receipt);
  if (!receipt || !witness) throw new RangeError(`No receipt and arguments exist for step ${step}`);
  return { step, receipt, args: witness.args, argsSalt: witness.salt, salt: stepSalt(privateKeyPem, policyHash(policy), receipt.hash) };
}

export function verifyDisclosure(proof: PropertyProof, disclosure: Disclosure, publicKeyPem: string, expectedPolicyHash: string | null = DEFAULT_POLICY_HASH): VerifyPropertyResult {
  const base = verifyPropertyProof(proof, publicKeyPem, undefined, expectedPolicyHash);
  if (!base.valid) return base;
  const { step, receipt, args, argsSalt, salt } = disclosure;
  const item = proof.steps.find((entry) => entry.step === step);
  if (!item) return { valid: false, step, reason: 'Step is not part of this proof' };
  const { hash, signature, ...input } = receipt;
  if (sha256(stableJson(input)) !== item.leaf || hash !== item.leaf || receipt.step !== step) return { valid: false, step, reason: 'Disclosed receipt does not match the proven leaf' };
  if (!argsMatch(receipt.argsHash, args, argsSalt)) return { valid: false, step, reason: 'Disclosed arguments do not match the signed argsHash' };
  if (commitmentFor(proof.policyHash, step, item.leaf, receipt.argsHash, salt) !== item.commitment) return { valid: false, step, reason: 'Disclosure does not open the property commitment' };
  const violation = evaluateStep(receipt, args, proof.policy);
  if (violation) return { valid: false, step, reason: violation };
  return base;
}
