import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceipt, generateSigningKey, merkleProof, proveNoSecrets, verifyChain, verifyMerkleProof, type ReceiptInput } from '../packages/receipts/src/index.ts';

function receiptsFixture(secretsAccessed = false) {
  const keys = generateSigningKey();
  const items: ReturnType<typeof createReceipt>[] = [];
  for (let step = 1; step <= 3; step++) {
    const input: ReceiptInput = { sessionId: 'test-session', step, timestamp: `2026-01-01T00:00:0${step}.000Z`, tool: 'read_file', argsHash: `args-${step}`, paths: [`src/file-${step}.ts`], secretsAccessed: secretsAccessed && step === 2, permissions: ['workspace:file:read'], cost: null, approver: null, resultHash: `result-${step}`, previousHash: items.at(-1)?.hash ?? null };
    items.push(createReceipt(input, keys.privateKey));
  }
  return { keys, items };
}

test('signs and verifies every receipt in an ordered chain', () => {
  const { keys, items } = receiptsFixture();
  assert.deepEqual(verifyChain(items, keys.publicKey), { valid: true, brokenAt: null, reason: null });
});

test('reports the exact receipt changed after signing', () => {
  const { keys, items } = receiptsFixture();
  items[1].tool = 'shell';
  assert.deepEqual(verifyChain(items, keys.publicKey), { valid: false, brokenAt: 2, reason: 'Receipt contents were changed' });
});

test('rejects broken links and reordered steps', () => {
  const { keys, items } = receiptsFixture();
  items[2].previousHash = '0'.repeat(64);
  assert.equal(verifyChain(items, keys.publicKey).brokenAt, 3);
  const reordered = receiptsFixture();
  assert.equal(verifyChain([reordered.items[1], reordered.items[0]], reordered.keys.publicKey).brokenAt, 1);
});

test('generates membership proofs against the session root', () => {
  const { items } = receiptsFixture();
  const leaves = items.map(({ hash }) => hash);
  assert.ok(leaves.every((_, index) => verifyMerkleProof(merkleProof(leaves, index))));
});

test('proves no-secret policy only for a valid session', () => {
  const emptyKeys = generateSigningKey();
  const empty = proveNoSecrets([], emptyKeys.publicKey);
  assert.equal(empty.valid, false);
  if (!empty.valid) assert.equal(empty.reason, 'No receipts exist for this session');
  const safe = receiptsFixture();
  const result = proveNoSecrets(safe.items, safe.keys.publicKey);
  assert.equal(result.valid, true);
  if (result.valid) assert.ok(result.proofs.every(verifyMerkleProof));
  const unsafe = receiptsFixture(true);
  const violation = proveNoSecrets(unsafe.items, unsafe.keys.publicKey);
  assert.equal(violation.valid, false);
  if (!violation.valid) assert.equal(violation.reason, 'Secrets were accessed at step 2');
});

