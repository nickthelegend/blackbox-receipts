import { NextResponse } from 'next/server';
import { defaultSecretPolicy, merkleRoot, proveProperty, verifyPropertyProof } from '@blackbox/receipts';
import { loadReceipts, loadWitnesses, signingKeys } from '@blackbox/proxy/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Runs the same prove + verify pipeline as `blackbox-receipts prove`. The response carries only the
// proof bundle (leaf hashes, signatures, inclusion paths, commitments); raw arguments never leave the server.
export async function POST() {
  const [receipts, witnesses, keys] = await Promise.all([loadReceipts(), loadWitnesses(), signingKeys()]);
  // The root the dashboard was showing when the proof ran, so it can mark the result stale later.
  const sessionRoot = merkleRoot(receipts.map(({ hash }) => hash));
  const result = proveProperty(receipts, witnesses, defaultSecretPolicy, keys);
  if (!result.valid) return NextResponse.json({ status: 'FAIL', step: result.step, reason: result.reason, policyId: defaultSecretPolicy.id, sessionRoot });
  const check = verifyPropertyProof(result.proof, keys.publicKey);
  if (!check.valid) return NextResponse.json({ status: 'FAIL', step: check.step, reason: check.reason, policyId: defaultSecretPolicy.id, sessionRoot });
  return NextResponse.json({ status: 'PASS', step: null, reason: null, policyId: defaultSecretPolicy.id, sessionRoot, steps: check.steps, root: check.root, proof: result.proof });
}
