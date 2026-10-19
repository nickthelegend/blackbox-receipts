// One-shot MCP client: `blackbox-call [--new-session] <tool> '<json args>'`.
// Starts the Blackbox proxy over stdio, makes one real MCP tool call through it (so the call gets a
// signed receipt), prints the tool output and exits non-zero if the proxy denied or failed the call.
// GitLab Duo flows that run on CI runners cannot attach MCP servers, so their agent reaches the
// proxy through this bridge with `run_command`.
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const argv = process.argv.slice(2);
const newSession = argv[0] === '--new-session';
const [tool, rawArgs = '{}'] = newSession ? argv.slice(1) : argv;
if (!tool) {
  console.error(`Usage: blackbox-call [--new-session] <read_file|git|shell> '<json args>'
  read_file '{"path":"README.md"}'
  git '{"action":"status"}' | '{"action":"log"}' | '{"action":"show_stat","args":["HEAD"]}' | '{"action":"diff","args":["src/a.ts"]}' | '{"action":"show","args":["HEAD:src/a.ts"]}'
  shell '{"command":"ls -la src"}'   (only pwd, ls and cat)`);
  process.exit(2);
}
let args: Record<string, unknown>;
try { args = JSON.parse(rawArgs); } catch { console.error(`Arguments must be a JSON object, got: ${rawArgs}`); process.exit(2); }

const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
if (newSession) delete env.RECEIPTS_RESUME; else env.RECEIPTS_RESUME = '1';
const client = new Client({ name: 'blackbox-call', version: '0.1.0' });
// From the build this runs dist/server.js; from source (tests) it runs server.ts through tsx.
const fromSource = fileURLToPath(import.meta.url).endsWith('.ts');
const serverArgs = fromSource ? ['--conditions=source', '--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./server.ts', import.meta.url))] : [fileURLToPath(new URL('./server.js', import.meta.url))];
await client.connect(new StdioClientTransport({ command: process.execPath, args: serverArgs, cwd: process.cwd(), env }));
try {
  const result = await client.callTool({ name: tool, arguments: args });
  const text = (result.content as { type: string; text?: string }[]).map((item) => item.text ?? '').join('\n');
  if (result.isError) { console.error(`DENIED or FAILED (receipt recorded): ${text}`); process.exitCode = 1; }
  else {
    let output = text;
    try { const parsed = JSON.parse(text); if (parsed && typeof parsed.stdout === 'string') output = parsed.stdout + (parsed.stderr ? `\n[stderr]\n${parsed.stderr}` : ''); } catch { /* plain text output */ }
    process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
  }
} finally {
  await client.close();
}
