import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyChain, type Receipt } from '../packages/verify/src/index.ts';
import { connectProxy } from '../packages/proxy/src/client.ts';
import { renderExplanation, type Explanation, type ExplainStep } from '../packages/proxy/src/explain.ts';
import { repoRoot, runScript } from './fixtures/run.ts';

// "Explain why": the structured explanation (CLI --json, the proxy's blackbox_explain MCP tool) on a
// real proxy session, and the explanations committed next to the recorded agent runs.
function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-explain-'));
  writeFileSync(join(cwd, 'README.md'), '# demo\n');
  writeFileSync(join(cwd, '.env'), 'TOKEN=canary\n');
  const env = { RECEIPTS_DIR: join(cwd, '.blackbox'), BLACKBOX_KEY_DIR: mkdtempSync(join(tmpdir(), 'blackbox-keys-')), RECEIPTS_RESUME: undefined };
  return { cwd, env, cli: (...args: string[]) => runScript('packages/proxy/src/cli.ts', cwd, args, env) };
}
const text = (result: Record<string, unknown>) => ((result.content ?? []) as { text: string }[]).map((item) => item.text).join('\n');

test('blackbox_explain (MCP): listed with the tools, explains one step citing its receipts, and is itself recorded', async () => {
  const ws = workspace();
  const client = await connectProxy({ cwd: ws.cwd, env: ws.env });
  try {
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ['read_file', 'write_file', 'git', 'shell', 'blackbox_explain']);
    await client.callTool({ name: 'read_file', arguments: { path: 'README.md' } });
    assert.equal((await client.callTool({ name: 'read_file', arguments: { path: '.env' } })).isError, true);
    assert.equal((await client.callTool({ name: 'git', arguments: { action: 'log', args: ['-n', '1'] } })).isError, true);
    const one = await client.callTool({ name: 'blackbox_explain', arguments: { step: 2 } });
    assert.equal(one.isError, undefined, text(one));
    assert.match(text(one), /^# Step 2 of session [0-9a-f-]{36}\n\n`read_file \.env` → \*\*DENIED\*\* — Policy denied \(no-secrets-read\/v1\): read_file touched secret path matching "\.env\*" · violation/);
    assert.match(text(one), /- The proxy refused it before it ran, so the agent never received the contents/);
    assert.match(text(one), /## Cited receipts\n\n- step 2 \(this call\) `[0-9a-f]{64}`: signed record of read_file[^\n]*\n- step 1 \(hash link\) `[0-9a-f]{64}`: read_file README\.md\n/);
    assert.match(text(one), /Verdict for the session: `FAIL no-secrets-read at step 2 /);
    const all = await client.callTool({ name: 'blackbox_explain', arguments: {} });
    assert.match(text(all), /\*\*Verdict:\*\* `FAIL no-secrets-read at step 2 [^`]+`\n[\s\S]*- \*\*step 3\*\* \S+ `git log -n 1` → error — git log does not accept additional arguments/);
    const missing = await client.callTool({ name: 'blackbox_explain', arguments: { step: 99 } });
    assert.equal(missing.isError, true);
    assert.match(text(missing), /has no step 99/);
  } finally { await client.close(); }
  const receipts = readFileSync(join(ws.cwd, '.blackbox/session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
  assert.deepEqual(receipts.map((receipt) => [receipt.tool, receipt.outcome]), [['read_file', 'ok'], ['read_file', 'denied'], ['git', 'error'], ['blackbox_explain', 'ok'], ['blackbox_explain', 'ok'], ['blackbox_explain', 'error']]);
  assert.deepEqual(receipts[3].permissions, ['blackbox:explain']);
  assert.equal(verifyChain(receipts, readFileSync(join(ws.cwd, '.blackbox/public-key.pem'), 'utf8')).valid, true);

  // The CLI's --json is the same model: a finding and citations per step.
  const result = ws.cli('explain', '--json');
  assert.equal(result.code, 0, result.out);
  const model = JSON.parse(result.out) as Explanation;
  assert.equal(model.format, 'blackbox-explain/v1');
  assert.deepEqual(model.steps.map((step) => step.finding), ['allowed', 'violation', 'tool-error', 'allowed', 'allowed', 'tool-error']);
  assert.deepEqual(model.steps[1].cites.map((cite) => [cite.step, cite.role, cite.hash]), [[2, 'this call', receipts[1].hash], [1, 'hash link', receipts[0].hash]]);
  assert.equal(model.steps[1].verdictStep, true);
  assert.match(model.steps[0].why[0], /^Allowed by no-secrets-read\/v1: its path README\.md matches no secret glob/);
  assert.equal(renderExplanation(model), ws.cli('explain').out);
  const step = JSON.parse(ws.cli('explain', '--json', '--step', '3').out) as ExplainStep;
  assert.match(step.why[1], /refused it for another reason: git log does not accept additional arguments/);
  assert.equal(ws.cli('explain', '--step', '0').code, 2);
});

test('committed agent runs: explain.json renders to the committed explain.md and cites the exported receipts', () => {
  const base = join(repoRoot, 'receipts/agent-demo');
  for (const run of readdirSync(base)) {
    const dir = join(base, run);
    const model = JSON.parse(readFileSync(join(dir, 'explain.json'), 'utf8')) as Explanation;
    assert.equal(renderExplanation(model), readFileSync(join(dir, 'explain.md'), 'utf8'), run);
    assert.equal(model.verdict, readFileSync(join(dir, 'result.txt'), 'utf8').trim(), run);
    const receipts = readFileSync(join(dir, 'session.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Receipt);
    const hashes = new Map(receipts.map((receipt) => [receipt.step, receipt.hash]));
    assert.deepEqual(model.steps.map((step) => step.receipt), receipts.map((receipt) => receipt.hash), run);
    for (const step of model.steps) for (const cite of step.cites) assert.equal(cite.hash, hashes.get(cite.step), `${run} step ${step.step} cites step ${cite.step}`);
  }
});
