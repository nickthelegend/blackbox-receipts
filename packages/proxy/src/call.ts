#!/usr/bin/env node
// One-shot MCP client: `blackbox-call [--new-session] <tool> '<json args>'`.
// Starts the Blackbox proxy over stdio, makes one real MCP tool call through it (so the call gets a
// signed receipt), prints the tool output and exits non-zero if the proxy denied or failed the call.
// GitLab Duo flows that run on CI runners cannot attach MCP servers, so their agent reaches the
// proxy through this bridge with `run_command`.
import { connectProxy } from './client.js';

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

const client = await connectProxy({ name: 'blackbox-call', env: { RECEIPTS_RESUME: newSession ? undefined : '1' } });
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
