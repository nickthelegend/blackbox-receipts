// Turns a recorded session into a step-cited explanation: every statement names the receipt it comes
// from, and raw arguments are shown only when they open that receipt's signed argsHash.
// `explainModel` builds the structured form (`blackbox-receipts explain --json`, the dashboard's step
// drawer, the proxy's blackbox_explain tool); `renderExplanation` turns it into the markdown
// `blackbox-receipts explain` prints. The markdown is a pure function of the JSON.
import { argsMatch, evaluateStep, type Receipt, type SecretPolicy, type Witness } from '@blackbox/receipts';

export type ExplainInput = {
  receipts: Receipt[];
  witnesses: Witness[];
  policy: SecretPolicy;
  /** The prover's PASS/FAIL line, verbatim. */
  verdict: string;
  chain: { valid: boolean; brokenAt: number | null; reason: string | null };
  root: string;
  seal: string;
  /** How many receipts the signed seal covers, when it holds. */
  sealCount?: number | null;
};

export const EXPLAIN_FORMAT = 'blackbox-explain/v1' as const;

/** A receipt an explanation relies on, and what it shows. */
export type ExplainCitation = { step: number; hash: string; role: 'this call' | 'hash link' | 'came before'; note: string };
export type ExplainStep = {
  step: number;
  timestamp: string;
  tool: string;
  /** This step's receipt hash. */
  receipt: string;
  previousHash: string | null;
  /** What the call asked for: from the raw arguments when they open argsHash, else from the receipt's paths. */
  command: string;
  /** `opened`: the raw arguments match the signed argsHash. */
  args: 'opened' | 'missing' | 'mismatch';
  outcome: string;
  /** The denial or error message, when the arguments opened. */
  detail: string | null;
  /** allowed: within the policy and ran. refused: the tool or proxy refused it for a non-policy reason. violation: breaks the policy. untrusted: at or after a chain break. */
  finding: 'allowed' | 'tool-error' | 'violation' | 'untrusted' | 'unchecked';
  /** The policy rule it broke, for violations. */
  rule: string | null;
  /** Plain sentences, each backed by the cited receipts. */
  why: string[];
  cites: ExplainCitation[];
  /** True when the verdict line names this step. */
  verdictStep: boolean;
};
export type Explanation = {
  format: typeof EXPLAIN_FORMAT;
  sessionId: string;
  verdict: string;
  policy: string;
  chain: ExplainInput['chain'];
  root: string;
  seal: string;
  receiptCount: number;
  steps: ExplainStep[];
  /** The "Why" section's markdown lines: the session-level reasons for the verdict. */
  summary: string[];
};

const code = (text: string) => `\`${text.replaceAll('`', "'")}\``;
const clip = (text: string, size = 90) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);

/** One-line description of what a call asked for, from its raw arguments. */
export function describeCall(tool: string, args: unknown): string {
  const input = (args ?? {}) as Record<string, unknown>;
  if (tool === 'read_file' && typeof input.path === 'string') return `read_file ${input.path}`;
  if (tool === 'write_file' && typeof input.path === 'string') return `write_file ${input.path}`;
  if (tool === 'git') return clip(['git', String(input.action ?? '?'), ...((Array.isArray(input.args) ? input.args : []) as string[])].join(' '));
  if (tool === 'shell' && typeof input.command === 'string') return clip(`shell ${input.command}`);
  return clip(`${tool} ${JSON.stringify(args)}`);
}

export function explainModel({ receipts, witnesses, policy, verdict, chain, root, seal, sealCount = null }: ExplainInput): Explanation {
  const sessionId = receipts[0]?.sessionId ?? 'empty session';
  const verdictAt = Number(verdict.match(/ at step (\d+) /)?.[1] ?? NaN);
  const opened = new Map<number, { witness: Witness | undefined; ok: boolean }>();
  for (const receipt of receipts) {
    const witness = witnesses.find((item) => item.sessionId === receipt.sessionId && item.step === receipt.step);
    opened.set(receipt.step, { witness, ok: Boolean(witness && argsMatch(receipt.argsHash, witness.args, witness.salt)) });
  }
  const commandOf = (receipt: Receipt) => {
    const { witness, ok } = opened.get(receipt.step)!;
    return ok ? describeCall(receipt.tool, witness!.args) : `${receipt.tool} ${receipt.paths.join(' ')}`.trim();
  };
  const summary: string[] = [];
  if (!chain.valid) summary.push(`The log was changed after signing: step ${chain.brokenAt} fails verification (${chain.reason}). Nothing from step ${chain.brokenAt} on can be trusted.`);
  const steps: ExplainStep[] = receipts.map((receipt, index) => {
    const { witness, ok } = opened.get(receipt.step)!;
    const command = commandOf(receipt);
    const previous = index > 0 ? receipts[index - 1] : null;
    const rule = ok ? evaluateStep(receipt, witness!.args, policy) : null;
    const broken = !chain.valid && chain.brokenAt !== null && receipt.step >= chain.brokenAt;
    const cites: ExplainCitation[] = [{ step: receipt.step, hash: receipt.hash, role: 'this call', note: `signed record of ${receipt.tool}: paths, outcome "${receipt.outcome}", salted argsHash and resultHash` }];
    const why: string[] = [];
    let finding: ExplainStep['finding'];
    if (broken) {
      finding = 'untrusted';
      why.push(receipt.step === chain.brokenAt ? `This receipt fails verification (${chain.reason}), so the log was changed after the proxy signed it.` : `This receipt comes after the break at step ${chain.brokenAt}, so nothing it says can be trusted.`);
    } else if (rule) {
      finding = 'violation';
      why.push(`${command} violates ${policy.id}: ${rule}.`);
      why.push(receipt.outcome === 'denied' ? 'The proxy refused it before it ran, so the agent never received the contents; the attempt itself is what the proof reports.' : receipt.outcome === 'ok' ? 'The call ran and its result went back to the agent.' : receipt.outcome === 'error' ? 'The call failed.' : 'The receipt does not record an outcome.');
      const before = receipts.filter((item) => item.step < receipt.step).slice(-2);
      if (before.length) {
        why.push(`It came right after ${before.map((item) => `step ${item.step} (${commandOf(item)})`).join(' and ')}.`);
        // The call right before is cited once, as the hash link below.
        for (const item of before) if (item.step !== previous?.step) cites.push({ step: item.step, hash: item.hash, role: 'came before', note: commandOf(item) });
      }
    } else if (!ok) {
      finding = 'unchecked';
      why.push(witness ? 'The stored arguments do not match the signed argsHash, so the policy cannot be checked for this call and the proof cannot pass.' : 'The private witness has no arguments for this call, so the policy cannot be checked for it and the proof cannot pass.');
    } else if (receipt.outcome === 'error' || receipt.outcome === 'denied') {
      finding = 'tool-error';
      why.push(`Allowed by ${policy.id}: no path or argument matches a secret rule.`);
      why.push(`The ${receipt.outcome === 'denied' ? 'proxy' : 'tool'} refused it for another reason${witness?.detail ? `: ${witness.detail}` : ''}. That is not a policy violation, so it does not change the verdict.`);
    } else {
      finding = 'allowed';
      const paths = receipt.paths.filter(Boolean);
      why.push(`Allowed by ${policy.id}: ${paths.length ? `${paths.length === 1 ? 'its path' : 'its paths'} ${paths.join(', ')} ${paths.length === 1 ? 'matches' : 'match'} no secret glob` : 'it names no path beyond the workspace root'}, and no argument matches a secret-token pattern.`);
      why.push(`It ran${receipt.artifacts?.length ? ` and wrote ${receipt.artifacts.map((artifact) => `${artifact.path} (blob ${artifact.blob.slice(0, 10)})`).join(', ')}` : ''}; its arguments and result are committed in the receipt as salted hashes.`);
    }
    if (previous) {
      why.push(`Hash-linked to step ${previous.step}: this receipt's previousHash is ${previous.hash.slice(0, 12)}, the hash of step ${previous.step}.`);
      cites.push({ step: previous.step, hash: previous.hash, role: 'hash link', note: commandOf(previous) });
    } else why.push('First receipt of the session: it has no previousHash.');
    if (sealCount && receipt.step <= sealCount) why.push(`The proxy's signed seal covers it (steps 1 to ${sealCount}).`);
    if (receipt.step === verdictAt) why.push(`This is the step the verdict names: ${verdict}`);
    return {
      step: receipt.step, timestamp: receipt.timestamp, tool: receipt.tool, receipt: receipt.hash, previousHash: receipt.previousHash,
      command, args: ok ? 'opened' : witness ? 'mismatch' : 'missing', outcome: receipt.outcome ?? 'recorded', detail: ok && witness!.detail ? witness!.detail : null,
      finding, rule, why, cites, verdictStep: receipt.step === verdictAt,
    };
  });
  // Every step whose opened arguments break the policy, even after a chain break (the session-level Why).
  const violations = steps.filter((step) => step.rule);
  if (!violations.length && chain.valid && receipts.length) summary.push(`No step touches a path or argument that ${code(policy.id)} forbids.`);
  for (const step of violations) {
    const receipt = receipts.find((item) => item.step === step.step)!;
    const before = receipts.filter((item) => item.step < step.step).slice(-2).map((item) => `step ${item.step} ${code(opened.get(item.step)!.ok ? commandOf(item) : item.tool)}`);
    const ran = receipt.outcome === 'denied' ? 'The proxy refused it before it ran, so the agent never received the contents; the attempt itself is what the proof reports.' : receipt.outcome === 'ok' ? 'The call ran and its result went back to the agent.' : receipt.outcome === 'error' ? 'The call failed.' : '';
    summary.push(`- **step ${step.step}** ${code(step.command)} violates ${code(policy.id)}: ${step.rule}.${ran ? ` ${ran}` : ''}${before.length ? ` It came right after ${before.join(' and ')}.` : ''}`);
  }
  return { format: EXPLAIN_FORMAT, sessionId, verdict, policy: policy.id, chain, root, seal, receiptCount: receipts.length, steps, summary };
}

const outcomeLabel = (outcome: string) => (outcome === 'denied' ? '**DENIED**' : outcome === 'error' ? 'error' : outcome === 'ok' ? 'ok' : 'recorded');

/** The markdown `blackbox-receipts explain` prints, from the structured explanation alone. */
export function renderExplanation(model: Explanation): string {
  const lines: string[] = [];
  lines.push(`# Session ${model.sessionId}`, '');
  lines.push(`**Verdict:** ${code(model.verdict)}`, '');
  lines.push(`- Chain: ${model.chain.valid ? `${model.receiptCount} receipts, every signature and link verifies` : `broken at step ${model.chain.brokenAt}: ${model.chain.reason}`}`);
  lines.push(`- Merkle root: ${code(model.root)}`);
  lines.push(`- Seal: ${model.seal}`);
  lines.push(`- Policy: ${code(model.policy)}`, '');
  if (!model.steps.length) { lines.push('No tool calls were recorded, so there is nothing to explain.'); return `${lines.join('\n')}\n`; }
  lines.push('## Steps', '');
  for (const step of model.steps) {
    const detail = step.detail ? ` — ${step.detail}` : '';
    const note = step.args === 'missing' ? ' (raw arguments missing; shown from the receipt\'s paths)' : step.args === 'mismatch' ? ' (stored arguments do NOT match the signed argsHash; shown from the receipt\'s paths)' : '';
    lines.push(`- **step ${step.step}** ${step.timestamp.slice(11, 19)} ${code(step.command)} → ${outcomeLabel(step.outcome)}${detail}${note} · receipt ${code(step.receipt.slice(0, 12))}`);
  }
  lines.push('', '## Why', '');
  lines.push(...model.summary);
  lines.push('', '_Generated by `blackbox-receipts explain` from the signed receipts and the private witness. Each argument shown was checked against its receipt\'s argsHash._');
  return `${lines.join('\n')}\n`;
}

/** One step's explanation as markdown, for `explain --step N` and the blackbox_explain tool. */
export function renderStep(model: Explanation, stepNumber: number): string {
  const step = model.steps.find((item) => item.step === stepNumber);
  if (!step) return `Session ${model.sessionId} has no step ${stepNumber} (it has ${model.receiptCount} receipts).\n`;
  const lines = [`# Step ${step.step} of session ${model.sessionId}`, '', `${code(step.command)} → ${outcomeLabel(step.outcome)}${step.detail ? ` — ${step.detail}` : ''} · ${step.finding}`, '', '## Why', '', ...step.why.map((line) => `- ${line}`), '', '## Cited receipts', '', ...step.cites.map((cite) => `- step ${cite.step} (${cite.role}) ${code(cite.hash)}: ${cite.note}`), '', `Verdict for the session: ${code(model.verdict)}`];
  return `${lines.join('\n')}\n`;
}

/** Back-compatible: the markdown for a session. */
export function explainSession(input: ExplainInput): string {
  return renderExplanation(explainModel(input));
}
