// Build-time loader for the landing page. Everything the page plots comes from the real opencode runs
// committed under receipts/agent-demo/: the signed receipts, the seal, the verdict, the per-step arguments
// from `blackbox-receipts explain` (each checked against its receipt's argsHash), the per-step explanation
// from `explain --json` (explain.json) and the agent transcript.
// Nothing here is typed in by hand.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Explanation, ExplainStep } from '@blackbox/proxy/explain';

const FAIL_RUN = '933f87da-c941-4588-8716-d6c8df98aded';
const PASS_RUN = 'e51c6b41-baba-404e-97a9-9bb2270924a0';

export type FlightStep = { step: number; timestamp: string; at: number; tool: string; paths: string[]; outcome: string; secret: boolean; hash: string; previousHash: string | null; command: string; note: string | null; explain: ExplainStep | null };
export type Flight = {
  sessionId: string; agent: string; model: string; fixture: string;
  verdict: string; root: string; sealedAt: string; sealCount: number;
  steps: FlightStep[]; cockpit: string[];
  control: { sessionId: string; verdict: string; count: number; root: string; sealedAt: string; promptLine: string; failPromptLine: string; section: string | null; failSection: string | null };
};

function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Could not find the monorepo root above ${process.cwd()}`);
    dir = parent;
  }
  return dir;
}

const field = (text: string, name: string) => text.match(new RegExp(`^${name}: (.+)$`, 'm'))?.[1]?.trim() ?? '';

/** `- **step 3** 04:25:53 `read_file .env` → **DENIED** — reason · receipt …` lines from explain.md. */
function explainedSteps(markdown: string): Map<number, { command: string; note: string | null }> {
  const out = new Map<number, { command: string; note: string | null }>();
  for (const line of markdown.split('\n')) {
    const match = line.match(/^- \*\*step (\d+)\*\* \S+ `(.+?)` → (?:\*\*)?(\w+)(?:\*\*)?(?: — (.+?))? · receipt/);
    if (match) out.set(Number(match[1]), { command: match[2], note: match[4] ?? null });
  }
  return out;
}

/** The agent's own words between the refused .env call and its next tool call. */
function cockpitVoice(transcript: string): string[] {
  const lines = transcript.split('\n');
  const refused = lines.findIndex((line) => line.startsWith('✗') && line.includes('.env'));
  if (refused < 0) return [];
  const said: string[] = [];
  for (const line of lines.slice(refused + 1)) {
    if (line.startsWith('⚙') || line.startsWith('✗')) break;
    if (line.trim() && !line.startsWith('Error:')) said.push(line.trim().replace(/\*\*/g, ''));
  }
  return said;
}

export function loadFlight(): Flight {
  const base = join(repoRoot(), 'receipts', 'agent-demo');
  const read = (run: string, file: string) => readFileSync(resolve(base, run, file), 'utf8');
  const receipts = read(FAIL_RUN, 'session.jsonl').trim().split('\n').map((line) => JSON.parse(line));
  const seal = JSON.parse(read(FAIL_RUN, 'seal.json'));
  const agentInfo = read(FAIL_RUN, 'agent.txt');
  const explained = explainedSteps(read(FAIL_RUN, 'explain.md'));
  const explanation = JSON.parse(read(FAIL_RUN, 'explain.json')) as Explanation;
  const steps: FlightStep[] = receipts.map((receipt) => ({
    step: receipt.step, timestamp: receipt.timestamp, at: Date.parse(receipt.timestamp), tool: receipt.tool,
    paths: receipt.paths.filter(Boolean), outcome: receipt.outcome, secret: receipt.secretsAccessed, hash: receipt.hash, previousHash: receipt.previousHash,
    command: explained.get(receipt.step)?.command ?? `${receipt.tool} ${receipt.paths.join(' ')}`.trim(),
    note: explained.get(receipt.step)?.note ?? null,
    // Only an explanation of this exact receipt counts.
    explain: explanation.steps.find((item) => item.step === receipt.step && item.receipt === receipt.hash) ?? null,
  }));
  const controlSeal = JSON.parse(read(PASS_RUN, 'seal.json'));
  const promptLine = (run: string) => read(run, 'prompt.txt').split('\n').find((line) => line.startsWith('2)')) ?? '';
  return {
    sessionId: seal.sessionId, agent: field(agentInfo, 'agent'), model: field(agentInfo, 'model'), fixture: field(agentInfo, 'fixture'),
    verdict: read(FAIL_RUN, 'result.txt').trim(), root: seal.root, sealedAt: seal.sealedAt, sealCount: seal.count,
    steps, cockpit: cockpitVoice(read(FAIL_RUN, 'transcript.txt')),
    control: {
      sessionId: controlSeal.sessionId, verdict: read(PASS_RUN, 'result.txt').trim(), count: controlSeal.count, root: controlSeal.root, sealedAt: controlSeal.sealedAt,
      promptLine: promptLine(PASS_RUN), failPromptLine: promptLine(FAIL_RUN),
      // The fixture README's injected section was renamed between the runs (commit 6c975df). The earlier name is
      // the one that run's agent quoted in its transcript; the later one is the heading of the fixture README now.
      section: read(PASS_RUN, 'transcript.txt').match(/the "([^"]+)" section/)?.[1] ?? null,
      failSection: readFileSync(join(repoRoot(), 'examples/injection-repo/README.md'), 'utf8').match(/^## (.*agent.*)$/im)?.[1] ?? null,
    },
  };
}
