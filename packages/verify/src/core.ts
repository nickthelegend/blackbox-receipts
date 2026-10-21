// @blackbox/verify: everything needed to check Blackbox Receipts without the signing key, without raw
// arguments and without Node. Pure TypeScript plus @noble/curves (Ed25519) and @noble/hashes (SHA-256),
// so the same code runs in the CLI and, offline, in a browser tab. Signing and proving live in
// @blackbox/receipts, which builds on these definitions.
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

// ---------------------------------------------------------------- types

export type Receipt = {
  sessionId: string;
  step: number;
  timestamp: string;
  tool: string;
  argsHash: string;
  paths: string[];
  secretsAccessed: boolean;
  permissions: string[];
  cost: number | null;
  approver: string | null;
  /** How the call ended: ran (ok), refused by the policy before running (denied), or failed (error). Absent on receipts written before this field existed. */
  outcome?: 'ok' | 'denied' | 'error';
  resultHash: string;
  previousHash: string | null;
  hash: string;
  signature: string;
};
export type ReceiptInput = Omit<Receipt, 'hash' | 'signature'>;
export type Verification = { valid: boolean; brokenAt: number | null; reason: string | null };

/**
 * A signed statement of how long a session is: its id, receipt count, last hash and Merkle root.
 * The chain alone can't show that receipts were cut off the end (a shorter prefix still links up);
 * the seal can.
 */
export type Seal = { version: 1; sessionId: string; count: number; lastHash: string; root: string; sealedAt: string; signature: string };
export type SealCheck = { valid: boolean; reason: string | null };

export const NO_SECRETS_PROPERTY = 'no-secrets-read' as const;
export type SecretPolicy = {
  id: string;
  /** Globs matched against every path a step touched. `*` stays within a segment, `**` crosses segments, a leading `~/` means the home directory, other patterns match at any directory boundary. */
  secretPathGlobs: string[];
  /** Regular expressions (source strings) matched against every string argument, including shell commands. */
  secretArgPatterns: { name: string; pattern: string }[];
};
export type StepProof = { step: number; leaf: string; signature: string; inclusion: { hash: string; side: 'left' | 'right' }[]; commitment: string };
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
export type VerifyPropertyResult = { valid: true; steps: number; root: string; policyHash: string; policyId: string } | PropertyFailure;

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

// ---------------------------------------------------------------- primitives

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    // Keys with undefined values are dropped, as JSON.stringify does, so a receipt hashes the same before and after a JSON round trip.
    return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function sha256Hex(value: string | Uint8Array): string {
  return bytesToHex(sha256(typeof value === 'string' ? utf8ToBytes(value) : value));
}

const concat = (a: Uint8Array, b: Uint8Array) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };
const nodeHash = (left: string, right: string) => sha256Hex(concat(hexToBytes(left), hexToBytes(right)));

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text.trim());
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const SPKI_ED25519_PREFIX = '302a300506032b6570032100';

/** The raw 32-byte Ed25519 key inside an SPKI PEM ("-----BEGIN PUBLIC KEY-----"). Throws on anything else. */
export function publicKeyFromPem(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
  let der: Uint8Array;
  try { der = base64ToBytes(body); } catch { throw new Error('Public key is not valid PEM'); }
  if (der.length !== 44 || bytesToHex(der.slice(0, 12)) !== SPKI_ED25519_PREFIX) throw new Error('Public key is not an Ed25519 SPKI key');
  return der.slice(12);
}

/** Strict RFC 8032 verification (the same rule Node's crypto.verify applies), over the raw bytes of a hex digest. */
export function verifyDigestSignature(publicKey: Uint8Array, hexDigest: string, signatureBase64: string): boolean {
  try { return ed25519.verify(base64ToBytes(signatureBase64), hexToBytes(hexDigest), publicKey, { zip215: false }); } catch { return false; }
}

export function receiptDigest(input: ReceiptInput): string {
  return sha256Hex(stableJson(input));
}

// ---------------------------------------------------------------- Merkle tree

export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return sha256Hex('');
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) next.push(nodeHash(level[index], level[index + 1] ?? level[index]));
    level = next;
  }
  return level[0];
}

export type MerkleProof = { leaf: string; path: { hash: string; side: 'left' | 'right' }[]; root: string };

export function merkleProof(leaves: string[], targetIndex: number): MerkleProof {
  if (targetIndex < 0 || targetIndex >= leaves.length) throw new RangeError('Leaf index is outside the tree');
  let level = [...leaves];
  let index = targetIndex;
  const path: MerkleProof['path'] = [];
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    path.push({ hash: level[siblingIndex] ?? level[index], side: index % 2 === 0 ? 'right' : 'left' });
    const next: string[] = [];
    for (let offset = 0; offset < level.length; offset += 2) next.push(nodeHash(level[offset], level[offset + 1] ?? level[offset]));
    level = next;
    index = Math.floor(index / 2);
  }
  return { leaf: leaves[targetIndex], path, root: level[0] };
}

export function verifyMerkleProof(proof: MerkleProof): boolean {
  let value = proof.leaf;
  for (const item of proof.path) value = item.side === 'left' ? nodeHash(item.hash, value) : nodeHash(value, item.hash);
  return value === proof.root;
}

// ---------------------------------------------------------------- chain

export function verifyChain(receipts: Receipt[], publicKeyPem: string): Verification {
  const key = publicKeyFromPem(publicKeyPem);
  let previousHash: string | null = null;
  for (let index = 0; index < receipts.length; index++) {
    const receipt = receipts[index];
    const { hash, signature, ...input } = receipt;
    if (receipt.step !== index + 1) return { valid: false, brokenAt: index + 1, reason: 'Step sequence is invalid' };
    if (receipt.previousHash !== previousHash) return { valid: false, brokenAt: receipt.step, reason: 'Previous hash does not match' };
    if (receiptDigest(input) !== hash) return { valid: false, brokenAt: receipt.step, reason: 'Receipt contents were changed' };
    if (!verifyDigestSignature(key, hash, signature)) return { valid: false, brokenAt: receipt.step, reason: 'Signature is invalid' };
    previousHash = hash;
  }
  return { valid: true, brokenAt: null, reason: null };
}

// ---------------------------------------------------------------- seal

/** The hex digest a seal's signature covers. */
export function sealDigest(seal: Omit<Seal, 'signature'>): string {
  const { version, sessionId, count, lastHash, root, sealedAt } = seal;
  return sha256Hex(stableJson({ kind: 'blackbox-seal', version, sessionId, count, lastHash, root, sealedAt }));
}

/**
 * `exact`: the log must be exactly what was sealed (exports). `prefix`: the log may have grown since the
 * seal was written (a live session), but it must still contain every sealed receipt unchanged.
 */
export function verifySeal(seal: Seal | null | undefined, receipts: Receipt[], publicKeyPem: string, mode: 'exact' | 'prefix' = 'exact'): SealCheck {
  if (!seal) return { valid: false, reason: 'Seal is missing, so receipts removed from the end could not be detected' };
  let signatureOk = false;
  try { signatureOk = seal.version === 1 && verifyDigestSignature(publicKeyFromPem(publicKeyPem), sealDigest(seal), seal.signature); } catch { signatureOk = false; }
  if (!signatureOk) return { valid: false, reason: 'Seal signature is invalid' };
  if (receipts.length && receipts[0].sessionId !== seal.sessionId) return { valid: false, reason: `Seal belongs to session ${seal.sessionId}, not ${receipts[0].sessionId}` };
  if (receipts.length < seal.count) return { valid: false, reason: `Seal says ${seal.count} receipts ending at ${seal.lastHash.slice(0, 12)}, but the log has ${receipts.length}: receipts were removed from the end` };
  if (mode === 'exact' && receipts.length > seal.count) return { valid: false, reason: `Seal says ${seal.count} receipts, but the log has ${receipts.length}: receipts were added after sealing` };
  const sealed = receipts.slice(0, seal.count);
  if (sealed.at(-1)?.hash !== seal.lastHash) return { valid: false, reason: `Seal's last hash does not match receipt ${seal.count}` };
  if (merkleRoot(sealed.map(({ hash }) => hash)) !== seal.root) return { valid: false, reason: 'Seal root does not match the receipts it covers' };
  return { valid: true, reason: null };
}

// ---------------------------------------------------------------- property proofs

export function policyHash(policy: SecretPolicy): string {
  return sha256Hex(stableJson(policy));
}

/** Verifiers accept proofs made under this policy unless they pin another one explicitly. */
export const DEFAULT_POLICY_HASH = policyHash(defaultSecretPolicy);

/** The hex digest the proxy's attestation over a property proof covers. */
export function proofStatement(proof: Omit<PropertyProof, 'attestation'>): string {
  const { version, property, policyHash: digest, sessionId, root, receiptCount, steps } = proof;
  return sha256Hex(stableJson({ version, property, policyHash: digest, sessionId, root, receiptCount, commitments: steps.map(({ step, commitment }) => ({ step, commitment })) }));
}

function leafIndex(path: StepProof['inclusion']): number {
  return path.reduce((index, item, level) => index + (item.side === 'left' ? 2 ** level : 0), 0);
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
  let key: Uint8Array;
  try { key = publicKeyFromPem(publicKeyPem); } catch (error) { return { valid: false, step: null, reason: error instanceof Error ? error.message : String(error) }; }
  for (let index = 0; index < proof.steps.length; index++) {
    const item = proof.steps[index];
    if (item.step !== index + 1) return { valid: false, step: index + 1, reason: 'Step is missing or out of order' };
    if (!verifyDigestSignature(key, item.leaf, item.signature)) return { valid: false, step: item.step, reason: 'Receipt signature is invalid' };
    if (leafIndex(item.inclusion) !== index || !verifyMerkleProof({ leaf: item.leaf, path: item.inclusion, root: proof.root })) return { valid: false, step: item.step, reason: 'Merkle inclusion proof does not reach the session root' };
    if (!/^[0-9a-f]{64}$/.test(item.commitment)) return { valid: false, step: item.step, reason: 'Property commitment is malformed' };
  }
  if (!verifyDigestSignature(key, proofStatement(proof), proof.attestation)) return { valid: false, step: null, reason: 'Proxy attestation over the property commitments is invalid' };
  return { valid: true, steps: proof.steps.length, root: proof.root, policyHash: proof.policyHash, policyId: proof.policy.id };
}

