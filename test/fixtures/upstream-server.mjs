#!/usr/bin/env node
// A tiny, real stdio MCP server used as the proxy's upstream in tests and the overhead benchmark.
// Hand-written JSON-RPC (no SDK), so the proxy is tested against an implementation it doesn't share.
// Tools: echo {text}, add {a, b}, read_note {path} (reads a file under the cwd), fail {}.
// If UPSTREAM_LOG is set, every tools/call it receives is appended there, so tests can prove that a
// denied call never reached it. UPSTREAM_NO_DELAY=1 turns off the random 0-5 ms reply delay (benchmark).
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const tools = [
  { name: 'echo', description: 'Returns the text it was given.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'add', description: 'Adds two numbers.', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
  { name: 'read_note', description: 'Reads a text file relative to the working directory.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'fail', description: 'Always returns a tool error.', inputSchema: { type: 'object', properties: {} } },
];

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const text = (value, isError = false) => ({ content: [{ type: 'text', text: String(value) }], ...(isError ? { isError: true } : {}) });

async function callTool(name, args = {}) {
  if (process.env.UPSTREAM_LOG) appendFileSync(process.env.UPSTREAM_LOG, `${JSON.stringify({ name, args })}\n`);
  if (!process.env.UPSTREAM_NO_DELAY) await new Promise((done) => setTimeout(done, Math.random() * 5)); // finish out of order under load
  if (name === 'echo') return text(args.text);
  if (name === 'add') return { ...text(args.a + args.b), structuredContent: { sum: args.a + args.b } };
  if (name === 'read_note') return text(readFileSync(args.path, 'utf8'));
  if (name === 'fail') return text('upstream refused: this tool always fails', true);
  throw Object.assign(new Error(`Unknown tool ${name}`), { code: -32602 });
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return; // notifications (initialized, cancelled)
  try {
    if (method === 'initialize') send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture-upstream', version: '1.0.0' } } });
    else if (method === 'tools/list') send({ id, result: { tools } });
    else if (method === 'tools/call') send({ id, result: await callTool(params.name, params.arguments) });
    else if (method === 'ping') send({ id, result: {} });
    else send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (error) {
    send({ id, error: { code: error.code ?? -32603, message: error.message } });
  }
});
