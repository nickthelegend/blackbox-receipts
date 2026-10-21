import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

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
  resultHash: string;
  previousHash: string | null;
  hash: string;
  signature: string;
};

export type ReceiptInput = Omit<Receipt, 'hash' | 'signature'>;

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function generateSigningKey(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync('ed25519');
  return { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

function receiptPayload(input: ReceiptInput): string {
  return stableJson(input);
}

export function createReceipt(input: ReceiptInput, privateKeyPem: string): Receipt {
  const hash = sha256(receiptPayload(input));
  const signature = sign(null, Buffer.from(hash, 'hex'), createPrivateKey(privateKeyPem)).toString('base64');
  return { ...input, hash, signature };
}

export type Verification = { valid: boolean; brokenAt: number | null; reason: string | null };

export function verifyChain(receipts: Receipt[], publicKeyPem: string): Verification {
  const key = createPublicKey(publicKeyPem);
  let previousHash: string | null = null;
  for (let index = 0; index < receipts.length; index++) {
    const receipt = receipts[index];
    const { hash, signature, ...input } = receipt;
    if (receipt.step !== index + 1) return { valid: false, brokenAt: index + 1, reason: 'Step sequence is invalid' };
    if (receipt.previousHash !== previousHash) return { valid: false, brokenAt: receipt.step, reason: 'Previous hash does not match' };
    const computedHash = sha256(receiptPayload(input));
    if (computedHash !== hash) return { valid: false, brokenAt: receipt.step, reason: 'Receipt contents were changed' };
    if (!verify(null, Buffer.from(hash, 'hex'), key, Buffer.from(signature, 'base64'))) return { valid: false, brokenAt: receipt.step, reason: 'Signature is invalid' };
    previousHash = hash;
  }
  return { valid: true, brokenAt: null, reason: null };
}

export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return sha256('');
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(sha256(Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')])));
    }
    level = next;
  }
  return level[0];
}

export function merkleProof(leaves: string[], targetIndex: number): { leaf: string; path: { hash: string; side: 'left' | 'right' }[]; root: string } {
  if (targetIndex < 0 || targetIndex >= leaves.length) throw new RangeError('Leaf index is outside the tree');
  let level = [...leaves];
  let index = targetIndex;
  const path: { hash: string; side: 'left' | 'right' }[] = [];
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    const sibling = level[siblingIndex] ?? level[index];
    path.push({ hash: sibling, side: index % 2 === 0 ? 'right' : 'left' });
    const next: string[] = [];
    for (let offset = 0; offset < level.length; offset += 2) next.push(sha256(Buffer.concat([Buffer.from(level[offset], 'hex'), Buffer.from(level[offset + 1] ?? level[offset], 'hex')])));
    level = next;
    index = Math.floor(index / 2);
  }
  return { leaf: leaves[targetIndex], path, root: level[0] };
}

export function verifyMerkleProof(proof: ReturnType<typeof merkleProof>): boolean {
  let value = proof.leaf;
  for (const item of proof.path) {
    const left = item.side === 'left' ? item.hash : value;
    const right = item.side === 'right' ? item.hash : value;
    value = sha256(Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')]));
  }
  return value === proof.root;
}

/**
 * A signed statement of how long a session is: its id, receipt count, last hash and Merkle root.
 * The chain alone can't show that receipts were cut off the end (a shorter prefix still links up);
 * the seal can. The proxy writes one on shutdown and `export` writes one into every export.
 */
export type Seal = { version: 1; sessionId: string; count: number; lastHash: string; root: string; sealedAt: string; signature: string };
export type SealCheck = { valid: boolean; reason: string | null };

function sealDigest(seal: Omit<Seal, 'signature'>): Buffer {
  const { version, sessionId, count, lastHash, root, sealedAt } = seal;
  return Buffer.from(sha256(stableJson({ kind: 'blackbox-seal', version, sessionId, count, lastHash, root, sealedAt })), 'hex');
}

export function createSeal(receipts: Receipt[], privateKeyPem: string, sealedAt = new Date().toISOString()): Seal {
  if (!receipts.length) throw new RangeError('Cannot seal an empty session');
  const unsigned = { version: 1 as const, sessionId: receipts[0].sessionId, count: receipts.length, lastHash: receipts.at(-1)!.hash, root: merkleRoot(receipts.map(({ hash }) => hash)), sealedAt };
  return { ...unsigned, signature: sign(null, sealDigest(unsigned), createPrivateKey(privateKeyPem)).toString('base64') };
}

/**
 * `exact`: the log must be exactly what was sealed (exports). `prefix`: the log may have grown since the
 * seal was written (a live session), but it must still contain every sealed receipt unchanged.
 */
export function verifySeal(seal: Seal | null | undefined, receipts: Receipt[], publicKeyPem: string, mode: 'exact' | 'prefix' = 'exact'): SealCheck {
  if (!seal) return { valid: false, reason: 'Seal is missing, so receipts removed from the end could not be detected' };
  let signatureOk = false;
  try { signatureOk = seal.version === 1 && verify(null, sealDigest(seal), createPublicKey(publicKeyPem), Buffer.from(seal.signature, 'base64')); } catch { signatureOk = false; }
  if (!signatureOk) return { valid: false, reason: 'Seal signature is invalid' };
  if (receipts.length && receipts[0].sessionId !== seal.sessionId) return { valid: false, reason: `Seal belongs to session ${seal.sessionId}, not ${receipts[0].sessionId}` };
  if (receipts.length < seal.count) return { valid: false, reason: `Seal says ${seal.count} receipts ending at ${seal.lastHash.slice(0, 12)}, but the log has ${receipts.length}: receipts were removed from the end` };
  if (mode === 'exact' && receipts.length > seal.count) return { valid: false, reason: `Seal says ${seal.count} receipts, but the log has ${receipts.length}: receipts were added after sealing` };
  const sealed = receipts.slice(0, seal.count);
  if (sealed.at(-1)?.hash !== seal.lastHash) return { valid: false, reason: `Seal's last hash does not match receipt ${seal.count}` };
  if (merkleRoot(sealed.map(({ hash }) => hash)) !== seal.root) return { valid: false, reason: 'Seal root does not match the receipts it covers' };
  return { valid: true, reason: null };
}

export * from './property.js';
