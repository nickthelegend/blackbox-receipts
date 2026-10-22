// The Blackbox MCP proxy (stdio). Every tools/call is planned (validated, paths resolved), checked
// against the prover's policy, run only if allowed, and recorded as a signed, hash-linked receipt,
// whether it succeeded, failed or was denied. Tools come from the built-in workspace backend, or from
// any stdio MCP server given with `--upstream "<command>"` (or BLACKBOX_UPSTREAM).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { defaultSecretPolicy, evaluateCall } from '@blackbox/receipts';
import { textOf, type Backend, type Planned } from './backend.js';
import { builtinBackend } from './builtin.js';
import { connectUpstream } from './upstream.js';
import { renderExplanation, renderStep } from './explain.js';
import { explainCurrent } from './report.js';
import { addReceipt, archiveSession, CorruptLogError, isSecretPath, isStorePath, loadReceipts, resumeSession, sealSession } from './store.js';

const argv = process.argv.slice(2);
const upstreamIndex = argv.indexOf('--upstream');
const upstreamCommand = upstreamIndex >= 0 ? argv[upstreamIndex + 1] : process.env.BLACKBOX_UPSTREAM;
if (upstreamIndex >= 0 && !upstreamCommand) { console.error('blackbox-proxy: --upstream needs a command'); process.exit(2); }

class PolicyDenied extends Error {
  constructor(message: string, readonly secret: boolean) { super(message); }
}

// The proxy's guard is the prover's own rule set: a call the prover would flag is refused before it runs.
const policy = defaultSecretPolicy;
function guard(tool: string, planned: Planned, args: unknown) {
  const violation = evaluateCall(tool, planned.paths, args, policy)
    ?? (planned.paths.some(isSecretPath) ? `${tool} touched a secret directory` : null)
    // The store under any name (a RECEIPTS_DIR inside the workspace): its witness and log are off-limits.
    ?? (planned.paths.some(isStorePath) ? `${tool} touched the receipt store` : null);
  if (violation) throw new PolicyDenied(`Policy denied (${policy.id}): ${violation}`, true);
  if (planned.productionTarget) throw new PolicyDenied('Policy denied production target', false);
}

let backend: Backend;
try {
  backend = upstreamCommand ? await connectUpstream(upstreamCommand) : builtinBackend;
} catch (error) {
  console.error(`blackbox-proxy: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const server = new Server({ name: 'blackbox-receipts-proxy', version: '0.2.0' }, { capabilities: { tools: {} } });
// The proxy's own tool, next to the backend's: the step-cited explanation of the session so far. It is
// answered by the proxy (never forwarded upstream) and recorded like any other call.
const EXPLAIN_TOOL = 'blackbox_explain';
const explainTool: Tool = {
  name: EXPLAIN_TOOL,
  description: 'Explain this session from its signed receipts: the prover\'s no-secrets-read verdict and, for each recorded call, why it was allowed, refused or failed, citing the receipts it rests on. Pass step to explain one call. Covers the calls recorded before this one; this call is recorded too.',
  inputSchema: { type: 'object', properties: { step: { type: 'integer', minimum: 1, description: 'Explain only this step' } } },
};
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  const listed = await backend.listTools(request.params?.cursor);
  return request.params?.cursor ? listed : { ...listed, tools: [...listed.tools, explainTool] };
});

// Tool calls still running; shutdown waits for them so their receipts land before the seal.
const inFlight = new Set<Promise<unknown>>();
server.setRequestHandler(CallToolRequestSchema, (request) => {
  const call = handleCall(request.params.name, request.params.arguments ?? {});
  inFlight.add(call);
  void call.finally(() => inFlight.delete(call));
  return call;
});

async function explainCall(args: Record<string, unknown>): Promise<CallToolResult> {
  const step = args.step;
  let result: CallToolResult;
  let outcome: 'ok' | 'error' = 'ok';
  if (step !== undefined && !(Number.isInteger(step) && (step as number) >= 1)) { result = { isError: true, content: [{ type: 'text', text: `step must be a positive integer, got ${JSON.stringify(step)}` }] }; outcome = 'error'; }
  else {
    try {
      const model = await explainCurrent();
      const missing = step !== undefined && !model.steps.some((item) => item.step === step);
      result = { isError: missing || undefined, content: [{ type: 'text', text: step === undefined ? renderExplanation(model) : renderStep(model, step as number) }] };
      if (missing) outcome = 'error';
    } catch (error) {
      result = { isError: true, content: [{ type: 'text', text: `Could not explain the session: ${error instanceof Error ? error.message : String(error)}` }] };
      outcome = 'error';
    }
  }
  await addReceipt({ tool: EXPLAIN_TOOL, args, result: textOf(result), paths: [], secretsAccessed: false, permissions: ['blackbox:explain'], outcome, detail: outcome === 'error' ? textOf(result) : undefined });
  return result;
}

async function handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (name === EXPLAIN_TOOL) return explainCall(args);
  let planned: Planned | null = null;
  try {
    planned = await backend.plan(name, args);
    guard(name, planned, args);
    const { result, recorded, artifacts } = await planned.run();
    await addReceipt({ tool: name, args, result: recorded, paths: planned.paths, secretsAccessed: false, permissions: planned.permissions, outcome: result.isError ? 'error' : 'ok', detail: result.isError ? textOf(result) : undefined, artifacts });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const denied = error instanceof PolicyDenied;
    await addReceipt({ tool: name, args, result: { error: message }, paths: planned?.paths ?? [], secretsAccessed: denied && error.secret, permissions: planned?.permissions ?? [], outcome: denied ? 'denied' : 'error', detail: message });
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}

// On shutdown (client closed stdin, or SIGTERM/SIGINT) sign the session's final length into seal.json,
// so receipts later cut off the end of the log are detected.
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await Promise.race([Promise.allSettled([...inFlight]), new Promise((done) => setTimeout(done, 5000))]);
  try { await sealSession(); } catch (error) { console.error(`blackbox: could not seal the session: ${error instanceof Error ? error.message : String(error)}`); }
  await backend.close?.().catch(() => undefined);
  process.exit(0);
}
process.stdin.on('end', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

// A new proxy starts a new session; the previous one is archived under sessions/, never deleted (a log
// that no longer parses is kept as sessions/corrupt-*). A proxy resuming a session refuses to start on a
// corrupt log, so no tool runs whose receipt could not be appended.
if (!resumeSession) await archiveSession();
else {
  try { await loadReceipts(); } catch (error) {
    if (!(error instanceof CorruptLogError)) throw error;
    console.error(`blackbox-proxy: ${error.message}. Not resuming it: start a new session (blackbox-call --new-session, or a proxy without RECEIPTS_RESUME), which keeps the damaged log under sessions/.`);
    process.exit(1);
  }
}
await server.connect(new StdioServerTransport());
