// The prover's verdict and the step-cited explanation for the current session in the local store.
// Shared by the CLI (`prove`, `export`, `pack`, `explain`), the proxy's blackbox_explain tool and the
// dashboard's /api/explain route, so all three say the same thing.
import { DEFAULT_POLICY_HASH, defaultSecretPolicy, merkleRoot, proveProperty, verifyChain, verifyPropertyProof, verifySeal, type PropertyFailure, type PropertyProof, type Receipt, type SecretPolicy } from '@blackbox/receipts';
import { explainModel, type Explanation } from './explain.js';
import { loadReceipts, loadSeal, loadWitnesses, signingKeys } from './store.js';

/** The policy a verdict is judged against (verifiers pin no-secrets-read/v2 unless told otherwise). */
export type PinnedPolicy = { id: string; hash: string };
export const defaultPin: PinnedPolicy = { id: defaultSecretPolicy.id, hash: DEFAULT_POLICY_HASH };

export const policyTag = (pinned: PinnedPolicy) => `[policy ${pinned.id} ${pinned.hash.slice(0, 12)}]`;
export function failLine(result: PropertyFailure, pinned: PinnedPolicy = defaultPin) {
  return `FAIL no-secrets-read${result.step === null ? '' : ` at step ${result.step}`} ${policyTag(pinned)}: ${result.reason}`;
}

export type CurrentProof = { line: string; proof: PropertyProof | null; receipts: Receipt[]; publicKey: string; privateKey: string };

/** Proves the current session and checks the bundle the way a third party would, from the public key alone. */
export async function proveCurrent(policy: SecretPolicy = defaultSecretPolicy, pinned: PinnedPolicy = defaultPin): Promise<CurrentProof> {
  const [receipts, witnesses, keys, seal] = await Promise.all([loadReceipts(), loadWitnesses(), signingKeys(), loadSeal()]);
  const base = { receipts, publicKey: keys.publicKey, privateKey: keys.privateKey };
  // The proxy's last seal must still hold: the log may have grown since, but nothing sealed may be gone.
  // Checked once the chain itself holds, so an edited receipt is still reported at its own step.
  const sealed = seal && verifyChain(receipts, keys.publicKey).valid ? verifySeal(seal, receipts, keys.publicKey, 'prefix') : null;
  if (sealed && !sealed.valid) return { ...base, line: failLine({ valid: false, step: null, reason: sealed.reason! }, pinned), proof: null };
  const result = proveProperty(receipts, witnesses, policy, keys);
  if (!result.valid) return { ...base, line: failLine(result, pinned), proof: null };
  const check = verifyPropertyProof(result.proof, keys.publicKey, undefined, pinned.hash);
  if (!check.valid) return { ...base, line: failLine(check, pinned), proof: null };
  return { ...base, line: `PASS no-secrets-read ${policyTag(pinned)}: ${check.steps}/${result.proof.receiptCount} receipts satisfy the policy`, proof: result.proof };
}

/** The structured explanation of the current session: the verdict, then why each step is what it is. */
export async function explainCurrent(policy: SecretPolicy = defaultSecretPolicy, pinned: PinnedPolicy = defaultPin): Promise<Explanation> {
  const { line } = await proveCurrent(policy, pinned);
  const [receipts, witnesses, keys, seal] = await Promise.all([loadReceipts(), loadWitnesses(), signingKeys(), loadSeal()]);
  const chain = receipts.length ? verifyChain(receipts, keys.publicKey) : { valid: true, brokenAt: null, reason: null };
  const sealed = seal ? verifySeal(seal, receipts, keys.publicKey, 'prefix') : null;
  const sealText = !seal ? 'none yet (the proxy writes it when it shuts down)' : sealed!.valid ? `signed, covers ${seal.count} of ${receipts.length} receipts` : `BROKEN: ${sealed!.reason}`;
  return explainModel({ receipts, witnesses, policy, verdict: line, chain, root: merkleRoot(receipts.map(({ hash }) => hash)), seal: sealText, sealCount: seal && sealed!.valid ? seal.count : null });
}
