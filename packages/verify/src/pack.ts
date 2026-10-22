// A pack is one self-contained JSON file for a session: signed receipts, the proxy's public key, the
// signed seal, the property proof (when the prover passed) and the prover's verdict line. verifyPack
// checks all of it with no network, no private key and no raw arguments, and says which step broke.
import { DEFAULT_POLICY_HASH, merkleRoot, publishedPolicy, publicKeyFromPem, verifyChain, verifyPropertyProof, verifySeal, type PropertyProof, type Receipt, type Seal } from './core.js';

export const PACK_FORMAT = 'blackbox-pack/v1' as const;

export type Pack = {
  format: typeof PACK_FORMAT;
  createdAt: string;
  sessionId: string;
  publicKey: string;
  receipts: Receipt[];
  seal: Seal | null;
  proof: PropertyProof | null;
  /** The prover's PASS/FAIL line when the pack was made. Informational: it is not signed. */
  verdict: string;
};

export type StepStatus = {
  step: number;
  tool: string;
  paths: string[];
  outcome: string | null;
  timestamp: string;
  hash: string;
  /** ok: signature and link verify. broken: this receipt fails. untrusted: after a break. flagged: signed as a secret access. */
  status: 'ok' | 'broken' | 'untrusted' | 'flagged';
  reason: string | null;
};
export type PackCheck = { name: 'format' | 'key' | 'chain' | 'seal' | 'property'; ok: boolean; detail: string };
export type PackResult = {
  ok: boolean;
  headline: string;
  brokenAt: number | null;
  sessionId: string | null;
  root: string | null;
  policyId: string;
  steps: StepStatus[];
  checks: PackCheck[];
};
export type PackOptions = { expectedPolicyHash?: string; expectedPolicyId?: string; pinnedPublicKey?: string };

/** Parses a pack file, with a readable error for anything that isn't one. */
export function parsePack(text: string): Pack {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new Error(`Not JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const pack = value as Partial<Pack>;
  if (!pack || typeof pack !== 'object' || pack.format !== PACK_FORMAT) throw new Error(`Not a Blackbox pack (expected "format": "${PACK_FORMAT}")`);
  if (!Array.isArray(pack.receipts) || typeof pack.publicKey !== 'string') throw new Error('Pack is missing its receipts or public key');
  return pack as Pack;
}

export function verifyPack(pack: Pack, options: PackOptions = {}): PackResult {
  const expectedPolicyHash = options.expectedPolicyHash ?? DEFAULT_POLICY_HASH;
  const policyId = options.expectedPolicyId ?? publishedPolicy(expectedPolicyHash)?.id ?? 'pinned policy';
  const receipts = Array.isArray(pack?.receipts) ? pack.receipts : [];
  const checks: PackCheck[] = [];
  const steps: StepStatus[] = receipts.map((receipt, index) => ({ step: receipt?.step ?? index + 1, tool: String(receipt?.tool ?? '?'), paths: Array.isArray(receipt?.paths) ? receipt.paths : [], outcome: receipt?.outcome ?? null, timestamp: String(receipt?.timestamp ?? ''), hash: String(receipt?.hash ?? ''), status: 'ok', reason: null }));
  const result = (headline: string, brokenAt: number | null = null): PackResult => ({ ok: checks.every((check) => check.ok), headline, brokenAt, sessionId: receipts[0]?.sessionId ?? null, root: receipts.length ? merkleRoot(receipts.map(({ hash }) => hash)) : null, policyId, steps, checks });

  if (pack?.format !== PACK_FORMAT) { checks.push({ name: 'format', ok: false, detail: `Not a ${PACK_FORMAT} pack` }); return result(`FAIL: not a ${PACK_FORMAT} pack`); }
  if (!receipts.length) { checks.push({ name: 'format', ok: false, detail: 'The pack holds no receipts' }); return result('FAIL: the pack holds no receipts, so there is nothing to verify'); }
  checks.push({ name: 'format', ok: true, detail: `${receipts.length} receipts for session ${receipts[0].sessionId}` });

  try {
    publicKeyFromPem(pack.publicKey);
    if (options.pinnedPublicKey && options.pinnedPublicKey.trim() !== pack.publicKey.trim()) throw new Error('Pack public key does not match the pinned key');
    checks.push({ name: 'key', ok: true, detail: options.pinnedPublicKey ? 'Ed25519 key, matches the pinned key' : 'Ed25519 key (not pinned: anyone could have made a key; pin it to trust the signer)' });
  } catch (error) {
    checks.push({ name: 'key', ok: false, detail: error instanceof Error ? error.message : String(error) });
    return result(`FAIL: ${checks.at(-1)!.detail}`);
  }

  let chain;
  try { chain = verifyChain(receipts, pack.publicKey); } catch (error) { chain = { valid: false, brokenAt: 1, reason: error instanceof Error ? error.message : String(error) }; }
  if (chain.valid) checks.push({ name: 'chain', ok: true, detail: `${receipts.length} signatures and hash links verify` });
  else {
    checks.push({ name: 'chain', ok: false, detail: `Broken at step ${chain.brokenAt}: ${chain.reason}` });
    for (const item of steps) {
      if (item.step === chain.brokenAt) Object.assign(item, { status: 'broken', reason: chain.reason });
      else if (chain.brokenAt !== null && item.step > chain.brokenAt) Object.assign(item, { status: 'untrusted', reason: `Comes after the break at step ${chain.brokenAt}` });
    }
  }

  const seal = verifySeal(pack.seal, receipts, pack.publicKey, 'exact');
  checks.push({ name: 'seal', ok: seal.valid, detail: seal.valid ? `Signed seal covers all ${pack.seal!.count} receipts` : seal.reason! });

  // The property: a valid proof under the pinned policy, or, without one, the first receipt that is
  // itself signed as a secret access.
  const flagged = receipts.find((receipt) => receipt.secretsAccessed);
  if (flagged && chain.valid) {
    const item = steps.find((entry) => entry.step === flagged.step)!;
    Object.assign(item, { status: 'flagged', reason: `Signed as a secret access (${flagged.outcome === 'denied' ? 'denied by the proxy before it ran' : 'flagged by the proxy'})` });
  }
  if (pack.proof) {
    const proof = pack.proof.sessionId !== receipts[0].sessionId ? { valid: false as const, step: null, reason: 'Proof belongs to a different session' } : verifyPropertyProof(pack.proof, pack.publicKey, merkleRoot(receipts.map(({ hash }) => hash)), expectedPolicyHash);
    checks.push({ name: 'property', ok: proof.valid, detail: proof.valid ? `Proof verified: all ${proof.steps} receipts satisfy ${proof.policyId}` : `${proof.step === null ? '' : `Step ${proof.step}: `}${proof.reason}` });
  } else {
    checks.push({ name: 'property', ok: false, detail: flagged ? `No proof: step ${flagged.step} (${flagged.tool} ${flagged.paths.join(' ')}) is signed as a secret access` : `No property proof in the pack. Prover reported: ${pack.verdict || 'nothing'}` });
  }

  const failed = checks.find((check) => !check.ok);
  if (!failed) return result(`PASS ${policyId}: ${receipts.length} receipts, chain intact, seal matches, proof verified`);
  if (failed.name === 'chain') return result(`FAIL at step ${chain.brokenAt}: ${chain.reason}`, chain.brokenAt);
  if (failed.name === 'property' && flagged && !pack.proof) return result(`FAIL ${policyId} at step ${flagged.step}: ${failed.detail}`, null);
  return result(`FAIL ${failed.name}: ${failed.detail}`);
}
