import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { homedir } from 'node:os';
import { merkleProof, merkleRoot, sha256, stableJson, verifyChain, verifyMerkleProof, type Receipt } from './index.js';

// Selective-disclosure property proofs.
//
// The prover holds the full receipt chain plus the raw tool arguments (the witness). It evaluates a
// policy over every step and publishes only: each receipt's leaf hash and proxy signature, a Merkle
// inclusion path to the session root, and a salted per-step property commitment. Raw args, paths and
// results stay private. Any single step can later be opened with `discloseStep` and checked with
// `verifyDisclosure` without revealing the others.
//
// Trust model: the policy evaluation is attested by the proxy key, the same key that signed the
// receipts. This is not a zero-knowledge proof of the predicate; a Noir circuit would remove that trust.

export const NO_SECRETS_PROPERTY = 'no-secrets-read' as const;

export type SecretPolicy = {
  id: string;
  /** Globs matched against every path a step touched. `*` stays within a segment, `**` crosses segments, a leading `~/` means the home directory, other patterns match at any directory boundary. */
  secretPathGlobs: string[];
  /** Regular expressions (source strings) matched against every string argument, including shell commands. */
  secretArgPatterns: { name: string; pattern: string }[];
};

export const defaultSecretPolicy: SecretPolicy = {
  id: 'no-secrets-read/v1',
  secretPathGlobs: ['.env*', '*.pem', '*.key', 'id_rsa', 'id_ed25519', '~/.ssh/**', '.ssh/**', '~/.aws/**', '.aws/**', 'secrets/**', '.blackbox/**', 'credentials.json'],
  secretArgPatterns: [
    { name: 'private-key-block', pattern: '-----BEGIN [A-Z ]*PRIVATE KEY-----' },
    { name: 'aws-access-key-id', pattern: '\\bAKIA[0-9A-Z]{16}\\b' },
    { name: 'github-token', pattern: '\\bgh[pousr]_[A-Za-z0-9]{36,}\\b' },
    { name: 'gitlab-token', pattern: '\\bglpat-[A-Za-z0-9_-]{20,}\\b' },
    { name: 'api-secret-key', pattern: '\\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\\b' },
    { name: 'slack-token', pattern: '\\bxox[abprs]-[A-Za-z0-9-]{10,}\\b' },
  ],
};

/** Raw arguments for one step, kept privately next to the receipt log. */
export type Witness = { sessionId: string; step: number; args: unknown };

export type StepProof = {
  step: number;
  leaf: string;
  signature: string;
  inclusion: { hash: string; side: 'left' | 'right' }[];
  commitment: string;
};

export type PropertyProof = {
  version: 1;
  property: typeof NO_SECRETS_PROPERTY;
  policy: SecretPolicy;
  policyHash: string;
  sessionId: string;
  root: string;
  receiptCount: number;
  steps: StepProof[];
  attestation: string;
};

export type PropertyFailure = { valid: false; step: number | null; reason: string };
export type ProveResult = { valid: true; proof: PropertyProof } | PropertyFailure;
export type VerifyPropertyResult = { valid: true; steps: number; root: string; policyHash: string; policyId: string } | PropertyFailure;
export type Disclosure = { step: number; receipt: Receipt; args: unknown; salt: string };

export function policyHash(policy: SecretPolicy): string {
  return sha256(stableJson(policy));
}

/** Verifiers accept proofs made under this policy unless they pin another one explicitly. */
export const DEFAULT_POLICY_HASH = policyHash(defaultSecretPolicy);

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
  return new RegExp(home ? `^~/${source}$` : `(?:^|/)${source}$`);
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

/** Every string that could name a path: receipt paths, each argument, its shell tokens and the path part of `rev:path`. */
function pathCandidates(receipt: Receipt, args: unknown): string[] {
  const candidates = new Set<string>(receipt.paths);
  for (const text of collectStrings(args)) {
    for (const token of (text.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((item) => item.replace(/^["']|["']$/g, ''))) {
      candidates.add(token);
      if (token.includes(':')) candidates.add(token.split(':').at(-1)!);
      if (token.includes('=')) candidates.add(token.split('=').at(-1)!);
    }
  }
  return [...candidates].map(normalizePath).filter(Boolean);
}

/** Returns why a step violates the policy, or null when it satisfies it. */
export function evaluateStep(receipt: Receipt, args: unknown, policy: SecretPolicy): string | null {
  const globs = policy.secretPathGlobs.map((glob) => ({ glob, regex: globToRegExp(glob) }));
  for (const candidate of pathCandidates(receipt, args)) {
    const hit = globs.find(({ regex }) => regex.test(candidate));
    if (hit) return `${receipt.tool} touched secret path matching "${hit.glob}"`;
  }
  const strings = collectStrings(args);
  for (const { name, pattern } of policy.secretArgPatterns) {
    if (strings.some((text) => new RegExp(pattern).test(text))) return `${receipt.tool} arguments match secret pattern "${name}"`;
  }
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

function statement(proof: Omit<PropertyProof, 'attestation'>): Buffer {
  const { version, property, policyHash: digest, sessionId, root, receiptCount, steps } = proof;
  return Buffer.from(sha256(stableJson({ version, property, policyHash: digest, sessionId, root, receiptCount, commitments: steps.map(({ step, commitment }) => ({ step, commitment })) })), 'hex');
}

function witnessFor(witnesses: Witness[], receipt: Receipt): Witness | undefined {
  return witnesses.find((item) => item.sessionId === receipt.sessionId && item.step === receipt.step);
}

/** Checks the chain, evaluates the policy on every step and returns a shareable proof or the first failing step. */
export function proveProperty(receipts: Receipt[], witnesses: Witness[], policy: SecretPolicy, keys: { privateKey: string; publicKey: string }): ProveResult {
  if (receipts.length === 0) return { valid: false, step: null, reason: 'No receipts exist for this session, so there is nothing to prove' };
  const chain = verifyChain(receipts, keys.publicKey);
  if (!chain.valid) return { valid: false, step: chain.brokenAt, reason: `Chain verification failed: ${chain.reason}` };
  for (const receipt of receipts) {
    const witness = witnessFor(witnesses, receipt);
    if (!witness) return { valid: false, step: receipt.step, reason: 'Raw arguments for this step are missing, so the policy cannot be evaluated' };
    if (sha256(JSON.stringify(witness.args)) !== receipt.argsHash) return { valid: false, step: receipt.step, reason: 'Stored arguments do not match the signed argsHash' };
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
  return { valid: true, proof: { ...unsigned, attestation: sign(null, statement(unsigned), createPrivateKey(keys.privateKey)).toString('base64') } };
}

function leafIndex(path: StepProof['inclusion']): number {
  return path.reduce((index, item, level) => index + (item.side === 'left' ? 2 ** level : 0), 0);
}

function signatureValid(publicKeyPem: string, hexDigest: string, signature: string): boolean {
  try { return verify(null, Buffer.from(hexDigest, 'hex'), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64')); } catch { return false; }
}

/**
 * Verifies a proof using only the proxy public key. Never needs receipt contents or raw args.
 * The policy is pinned: a proof made under any policy other than `expectedPolicyHash` (default
 * no-secrets-read/v1) fails, so a prover can't pass by proving against a weaker policy. Pass null to
 * accept any policy (and then read `policyId` from the result).
 */
export function verifyPropertyProof(proof: PropertyProof, publicKeyPem: string, expectedRoot?: string, expectedPolicyHash: string | null = DEFAULT_POLICY_HASH): VerifyPropertyResult {
  if (proof?.version !== 1 || proof.property !== NO_SECRETS_PROPERTY) return { valid: false, step: null, reason: 'Unsupported proof format' };
  if (policyHash(proof.policy) !== proof.policyHash) return { valid: false, step: null, reason: 'Policy does not match its hash' };
  if (expectedPolicyHash && proof.policyHash !== expectedPolicyHash) return { valid: false, step: null, reason: `Proof was made under policy "${proof.policy.id}" (${proof.policyHash.slice(0, 12)}), not the pinned policy (${expectedPolicyHash.slice(0, 12)})` };
  if (!proof.receiptCount || !proof.steps?.length) return { valid: false, step: null, reason: 'Proof covers no receipts' };
  if (proof.steps.length !== proof.receiptCount) return { valid: false, step: null, reason: `Proof covers ${proof.steps.length} of ${proof.receiptCount} receipts` };
  if (expectedRoot && expectedRoot !== proof.root) return { valid: false, step: null, reason: 'Proof root does not match the expected session root' };
  for (let index = 0; index < proof.steps.length; index++) {
    const item = proof.steps[index];
    if (item.step !== index + 1) return { valid: false, step: index + 1, reason: 'Step is missing or out of order' };
    if (!signatureValid(publicKeyPem, item.leaf, item.signature)) return { valid: false, step: item.step, reason: 'Receipt signature is invalid' };
    if (leafIndex(item.inclusion) !== index || !verifyMerkleProof({ leaf: item.leaf, path: item.inclusion, root: proof.root })) return { valid: false, step: item.step, reason: 'Merkle inclusion proof does not reach the session root' };
    if (!/^[0-9a-f]{64}$/.test(item.commitment)) return { valid: false, step: item.step, reason: 'Property commitment is malformed' };
  }
  if (!signatureValid(publicKeyPem, statement(proof).toString('hex'), proof.attestation)) return { valid: false, step: null, reason: 'Proxy attestation over the property commitments is invalid' };
  return { valid: true, steps: proof.steps.length, root: proof.root, policyHash: proof.policyHash, policyId: proof.policy.id };
}

/** Opens one step's commitment for an auditor, revealing only that step's receipt and arguments. */
export function discloseStep(receipts: Receipt[], witnesses: Witness[], step: number, policy: SecretPolicy, privateKeyPem: string): Disclosure {
  const receipt = receipts.find((item) => item.step === step);
  const witness = receipt && witnessFor(witnesses, receipt);
  if (!receipt || !witness) throw new RangeError(`No receipt and arguments exist for step ${step}`);
  return { step, receipt, args: witness.args, salt: stepSalt(privateKeyPem, policyHash(policy), receipt.hash) };
}

export function verifyDisclosure(proof: PropertyProof, disclosure: Disclosure, publicKeyPem: string, expectedPolicyHash: string | null = DEFAULT_POLICY_HASH): VerifyPropertyResult {
  const base = verifyPropertyProof(proof, publicKeyPem, undefined, expectedPolicyHash);
  if (!base.valid) return base;
  const { step, receipt, args, salt } = disclosure;
  const item = proof.steps.find((entry) => entry.step === step);
  if (!item) return { valid: false, step, reason: 'Step is not part of this proof' };
  const { hash, signature, ...input } = receipt;
  if (sha256(stableJson(input)) !== item.leaf || hash !== item.leaf || receipt.step !== step) return { valid: false, step, reason: 'Disclosed receipt does not match the proven leaf' };
  if (sha256(JSON.stringify(args)) !== receipt.argsHash) return { valid: false, step, reason: 'Disclosed arguments do not match the signed argsHash' };
  if (commitmentFor(proof.policyHash, step, item.leaf, receipt.argsHash, salt) !== item.commitment) return { valid: false, step, reason: 'Disclosure does not open the property commitment' };
  const violation = evaluateStep(receipt, args, proof.policy);
  if (violation) return { valid: false, step, reason: violation };
  return base;
}
