// The Blackbox MCP proxy (stdio). Every tools/call is planned (validated, paths resolved), checked
// against the prover's policy, run only if allowed, and recorded as a signed, hash-linked receipt,
// whether it succeeded, failed or was denied. Tools come from the built-in workspace backend, or from
// any stdio MCP server given with `--upstream "<command>"` (or BLACKBOX_UPSTREAM).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { defaultSecretPolicy, evaluateCall } from '@blackbox/receipts';
import { textOf, type Backend, type Planned } from './backend.js';
import { builtinBackend } from './builtin.js';
import { connectUpstream } from './upstream.js';
import { addReceipt, archiveSession, isSecretPath, resumeSession, sealSession } from './store.js';

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
  const violation = evaluateCall(tool, planned.paths, args, policy) ?? (planned.paths.some(isSecretPath) ? `${tool} touched a secret directory` : null);
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
server.setRequestHandler(ListToolsRequestSchema, (request) => backend.listTools(request.params?.cursor));

// Tool calls still running; shutdown waits for them so their receipts land before the seal.
const inFlight = new Set<Promise<unknown>>();
server.setRequestHandler(CallToolRequestSchema, (request) => {
  const call = handleCall(request.params.name, request.params.arguments ?? {});
  inFlight.add(call);
  void call.finally(() => inFlight.delete(call));
  return call;
});

async function handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
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

// A new proxy starts a new session; the previous one is archived under sessions/, never deleted.
if (!resumeSession) await archiveSession();
await server.connect(new StdioServerTransport());
