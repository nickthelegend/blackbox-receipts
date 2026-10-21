// @blackbox/receipts: signing and proving (Node). Verification comes from @blackbox/verify, which runs in
// Node and in the browser; this package re-exports it so there is one implementation of every check.
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { merkleRoot, receiptDigest, sealDigest, stableJson, type Receipt, type ReceiptInput, type Seal } from '@blackbox/verify';

export * from '@blackbox/verify';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Salted commitments to a call's arguments and result: sha256 over a fresh per-step salt and canonical
 * JSON. The salt stays in the private witness, so a published receipt can't be matched against guessed
 * low-entropy arguments (a file path, a short command). Receipts still show `tool` and `paths` in clear.
 */
export function newSalt(): string {
  return randomBytes(16).toString('hex');
}

export function hashArgs(args: unknown, salt: string): string {
  return sha256(`blackbox-args/v2|${salt}|${stableJson(args)}`);
}

export function hashResult(result: unknown, salt: string): string {
  return sha256(`blackbox-result/v2|${salt}|${stableJson(result)}`);
}

/** Whether these raw arguments open a receipt's argsHash. Witnesses without a salt predate v2 hashing. */
export function argsMatch(argsHash: string, args: unknown, salt?: string): boolean {
  return salt ? hashArgs(args, salt) === argsHash : sha256(JSON.stringify(args)) === argsHash;
}

export function generateSigningKey(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync('ed25519');
  return { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

/** Ed25519 signature (base64) over the raw bytes of a hex digest. */
export function signDigest(hexDigest: string, privateKeyPem: string): string {
  return sign(null, Buffer.from(hexDigest, 'hex'), createPrivateKey(privateKeyPem)).toString('base64');
}

export function createReceipt(input: ReceiptInput, privateKeyPem: string): Receipt {
  const hash = receiptDigest(input);
  return { ...input, hash, signature: signDigest(hash, privateKeyPem) };
}

/** Signs the current length of a session: the proxy writes one on shutdown and `export` into every export. */
export function createSeal(receipts: Receipt[], privateKeyPem: string, sealedAt = new Date().toISOString()): Seal {
  if (!receipts.length) throw new RangeError('Cannot seal an empty session');
  const unsigned = { version: 1 as const, sessionId: receipts[0].sessionId, count: receipts.length, lastHash: receipts.at(-1)!.hash, root: merkleRoot(receipts.map(({ hash }) => hash)), sealedAt };
  return { ...unsigned, signature: signDigest(sealDigest(unsigned), privateKeyPem) };
}

export * from './property.js';
