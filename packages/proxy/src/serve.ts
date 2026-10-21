import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { defaultSecretPolicy, evaluateCall } from '@blackbox/receipts';
import { addReceipt, archiveSession, isSecretPath, resumeSession, safeFilePath, safePath, sealSession } from './store.js';

const execFileAsync = promisify(execFile);
const server = new Server({ name: 'blackbox-receipts-proxy', version: '0.1.0' }, { capabilities: { tools: {} } });
const toolList = [
  { name: 'read_file', description: 'Read a UTF-8 text file from the current workspace. Secret paths are blocked and recorded.', inputSchema: { path: z.string() } },
  { name: 'git', description: 'Run read-only git status, diff, log, show (rev:path), or show_stat (files changed by one revision) in the current workspace.', inputSchema: { action: z.enum(['status', 'diff', 'log', 'show', 'show_stat']), args: z.array(z.string()).default([]) } },
  { name: 'shell', description: 'Run a shell command in the current workspace. Secret reads and production targets are blocked.', inputSchema: { command: z.string() } },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList.map(({ name, description, inputSchema }) => ({ name, description, inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(inputSchema).map(([key, schema]) => [key, { type: key === 'args' ? 'array' : 'string' }])), required: name === 'git' ? ['action'] : name === 'read_file' ? ['path'] : ['command'] } })) }));

// Tool calls still running; shutdown waits for them so their receipts land before the seal.
const inFlight = new Set<Promise<unknown>>();

server.setRequestHandler(CallToolRequestSchema, (request) => {
  const call = handleCall(request.params);
  inFlight.add(call);
  void call.finally(() => inFlight.delete(call));
  return call;
});

class PolicyDenied extends Error {
  constructor(message: string, readonly secret: boolean) { super(message); }
}

// The proxy's guard is the prover's own rule set: a call the prover would flag is refused before it runs.
const policy = defaultSecretPolicy;
function guard(tool: string, paths: string[], args: unknown) {
  const violation = evaluateCall(tool, paths, args, policy) ?? (paths.some(isSecretPath) ? `${tool} touched a secret directory` : null);
  if (violation) throw new PolicyDenied(`Policy denied (${policy.id}): ${violation}`, true);
}

type Planned = { paths: string[]; permissions: string[]; productionTarget?: boolean; run: () => Promise<unknown> };

/** Validates a call and works out which paths it touches, without running it. */
function plan(name: string, args: Record<string, unknown>): Planned {
  if (name === 'read_file') {
    const target = safePath(z.string().parse(args.path));
    return { paths: [target.relativePath], permissions: ['workspace:file:read'], run: () => readFile(target.path, 'utf8') };
  }
  if (name === 'git') {
    const action = z.enum(['status', 'diff', 'log', 'show', 'show_stat']).parse(args.action);
    const requested = z.array(z.string()).parse(args.args ?? []);
    let paths: string[] = [];
    if (action === 'status' && requested.length) throw new Error('git status does not accept additional arguments');
    if (action === 'log' && requested.length) throw new Error('git log does not accept additional arguments');
    if (action === 'diff') {
      if (!requested.length || requested.some((path) => path.startsWith('-') || /[*?\[\]]/.test(path))) throw new Error('git diff requires explicit, literal file paths');
      paths = requested.map((path) => safeFilePath(path).relativePath);
    }
    if (action === 'show') {
      if (requested.length !== 1 || !requested[0].includes(':') || /[*?\[\]]/.test(requested[0])) throw new Error('git show requires one revision:path argument');
      paths = [safeFilePath(requested[0].split(':').at(-1)!).relativePath];
    }
    if (action === 'show_stat' && (requested.length > 1 || requested.some((rev) => !/^[A-Za-z0-9][A-Za-z0-9._/~^-]*$/.test(rev)))) throw new Error('git show_stat accepts at most one plain revision');
    const gitArgs: Record<string, string[]> = {
      status: ['status', '--short'],
      diff: ['diff', '--', ...paths],
      log: ['log', '-n', '20', '--oneline'],
      show: ['show', requested[0]],
      show_stat: ['show', '--stat', '--format=%H %s', requested[0] ?? 'HEAD', '--'],
    };
    return { paths, permissions: ['workspace:git:read'], run: async () => (await execFileAsync('git', gitArgs[action], { cwd: process.cwd(), maxBuffer: 2_000_000 })).stdout };
  }
  if (name === 'shell') {
    const command = z.string().parse(args.command);
    const tokens = command.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map((token) => token.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')) ?? [];
    const executable = tokens.shift();
    if (!executable || !['pwd', 'ls', 'cat'].includes(executable) || tokens.some((token) => /[;&|><$`*?\[\]]/.test(token))) throw new Error('Shell allows only pwd, ls, and cat with direct arguments');
    if (executable === 'pwd' && tokens.length) throw new Error('pwd does not accept additional arguments');
    if (executable === 'ls' && tokens.some((token) => token.startsWith('-') && !['-a', '-l', '-la', '-al', '--'].includes(token))) throw new Error('ls allows only -a and -l options');
    if (executable === 'cat' && tokens.some((token) => token.startsWith('-') && token !== '--')) throw new Error('cat options are not allowed');
    const candidates = executable === 'ls' ? tokens.filter((token) => !token.startsWith('-')) : tokens.filter((token) => token !== '--');
    const paths = (candidates.length ? candidates : executable === 'ls' ? ['.'] : []).map((candidate) => safePath(candidate).relativePath);
    const productionTarget = tokens.some((token) => /\b(prod(?:uction)?|mainnet)\b/i.test(token));
    return { paths, permissions: ['workspace:shell:execute'], productionTarget, run: async () => { const result = await execFileAsync(executable, tokens, { cwd: process.cwd(), maxBuffer: 2_000_000, timeout: 30_000 }); return { stdout: result.stdout, stderr: result.stderr }; } };
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function handleCall(params: { name: string; arguments?: Record<string, unknown> }) {
  const { name, arguments: args = {} } = params;
  let planned: Planned | null = null;
  try {
    planned = plan(name, args);
    guard(name, planned.paths, args);
    if (planned.productionTarget) throw new PolicyDenied('Policy denied production target', false);
    const output = await planned.run();
    await addReceipt({ tool: name, args, result: output, paths: planned.paths, secretsAccessed: false, permissions: planned.permissions, outcome: 'ok' });
    return { content: [{ type: 'text' as const, text: typeof output === 'string' ? output : JSON.stringify(output) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const denied = error instanceof PolicyDenied;
    await addReceipt({ tool: name, args, result: { error: message }, paths: planned?.paths ?? [], secretsAccessed: denied && error.secret, permissions: planned?.permissions ?? [], outcome: denied ? 'denied' : 'error', detail: message });
    return { isError: true, content: [{ type: 'text' as const, text: message }] };
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
  process.exit(0);
}
process.stdin.on('end', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

const transport = new StdioServerTransport();
// A new proxy starts a new session; the previous one is archived under sessions/, never deleted.
if (!resumeSession) await archiveSession();
await server.connect(transport);
