// Optional model-written narrative over an explanation, from the Meterless Runtime (a local
// OpenAI-compatible provider; no hosted key). The model only rewrites the step-cited facts the
// explainer produced; every step it cites is checked against the session, and the deterministic
// explanation stays the record. Nothing here runs unless --model meterless is asked for.
import type { Explanation } from './explain.js';

export type Narrative = { provider: 'meterless'; model: string; text: string; cited: number[]; unknownSteps: number[] };
type ChatClient = { chat: (messages: { role: 'system' | 'user' | 'assistant'; content: string }[], model?: string) => Promise<string> };

const SYSTEM = 'You explain a recorded AI-agent session to a code reviewer. Use only the facts given. Write 3 to 6 short sentences in plain English: what the agent did, what was refused or failed and why, and what the verdict means. Cite every claim with the step it rests on, written exactly as (step N). Never mention a step number that is not listed.';

/** The facts the model sees: the verdict and each step's command, outcome and reasons. */
export function narrationPrompt(model: Explanation): string {
  const steps = model.steps.map((step) => `step ${step.step}: ${step.command} -> ${step.outcome}${step.detail ? ` (${step.detail})` : ''}; finding: ${step.finding}; why: ${step.why.join(' ')}`);
  return [`Verdict: ${model.verdict}`, `Policy: ${model.policy}`, `Chain: ${model.chain.valid ? 'intact' : `broken at step ${model.chain.brokenAt}`}`, `Steps (${model.steps.length}):`, ...steps].join('\n');
}

/** Step numbers a narrative cites as "(step N)" or "step N", and those the session does not have. */
export function checkCitations(text: string, model: Explanation): { cited: number[]; unknownSteps: number[] } {
  const cited = [...new Set([...text.matchAll(/\bsteps? (\d+)(?:\s*(?:,|and|to|-)\s*(\d+))*/gi)].flatMap((match) => match[0].match(/\d+/g)!.map(Number)))].sort((a, b) => a - b);
  const known = new Set(model.steps.map((step) => step.step));
  return { cited, unknownSteps: cited.filter((step) => !known.has(step)) };
}

export async function narrate(model: Explanation, client: ChatClient, routing = 'meterless/auto'): Promise<Narrative> {
  const text = (await client.chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: narrationPrompt(model) }], routing)).trim();
  return { provider: 'meterless', model: routing, text, ...checkCitations(text, model) };
}

export function renderNarrative(narrative: Narrative): string {
  const unknown = narrative.unknownSteps.length ? ` Steps it names that the session does not have: ${narrative.unknownSteps.join(', ')} (ignore those claims).` : '';
  return `\n## Narrative (model-written by Meterless ${narrative.model})\n\n${narrative.text}\n\n_Rewritten by a local model from the step-cited facts above, which remain the record. Steps it cites: ${narrative.cited.join(', ') || 'none'}.${unknown}_\n`;
}
