import { NextResponse } from 'next/server';
import { defaultSecretPolicy, discloseStep, merkleRoot, proveProperty, verifyChain, verifyPropertyProof } from '@blackbox/receipts';
import { loadReceipts, loadWitnesses, signingKeys } from '@blackbox/proxy/store';
import { corruptResponse } from '../corrupt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Runs the same prove + verify pipeline as `blackbox-receipts prove`. The response carries only the
// proof bundle (leaf hashes, signatures, inclusion paths, commitments); raw arguments never leave the server.
export async function POST() {
  let loaded;
  try { loaded = await Promise.all([loadReceipts(), loadWitnesses(), signingKeys()]); } catch (error) {
    const response = corruptResponse(error);
    if (response) return response;
    throw error;
  }
  const [receipts, witnesses, keys] = loaded;
  // The root the dashboard was showing when the proof ran, so it can mark the result stale later. The root is
  // over the receipt hashes, which an on-disk edit (the tamper test) leaves alone, so the chain's break point at
  // proof time is returned too: a tamper or restore after the proof also makes it stale.
  const sessionRoot = merkleRoot(receipts.map(({ hash }) => hash));
  const chainBrokenAt = verifyChain(receipts, keys.publicKey).brokenAt;
  const result = proveProperty(receipts, witnesses, defaultSecretPolicy, keys);
  if (!result.valid) return NextResponse.json({ status: 'FAIL', step: result.step, reason: result.reason, policyId: defaultSecretPolicy.id, sessionRoot, chainBrokenAt });
  const check = verifyPropertyProof(result.proof, keys.publicKey);
  if (!check.valid) return NextResponse.json({ status: 'FAIL', step: check.step, reason: check.reason, policyId: defaultSecretPolicy.id, sessionRoot, chainBrokenAt });
  // Keep the native signed proof so existing offline verifiers can still consume downloads,
  // and supply the dashboard API's documented names alongside it. An opening is only the
  // property commitment salt: never include raw arguments or their private argsHash salt.
  const proof = {
    ...result.proof,
    format: 'blackbox-property-proof/v1',
    policyId: defaultSecretPolicy.id,
    count: result.proof.receiptCount,
    publicKey: keys.publicKey,
    leaves: result.proof.steps.map(({ step, leaf, signature, inclusion }) => ({
      step, leafHash: leaf, receiptHash: leaf, signature, inclusionPath: inclusion.map(({ hash }) => hash),
    })),
    commitments: result.proof.steps.map(({ step, commitment }) => ({
      step, commitment, opening: discloseStep(receipts, witnesses, step, defaultSecretPolicy, keys.privateKey).salt,
    })),
  };
  return NextResponse.json({ status: 'PASS', step: null, reason: null, policyId: defaultSecretPolicy.id, sessionRoot, chainBrokenAt, steps: check.steps, root: check.root, proof });
}
