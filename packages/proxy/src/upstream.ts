// Upstream backend: spawns any stdio MCP server and proxies it. tools/list passes through unchanged;
// every tools/call is checked against the policy first, forwarded only if allowed, and recorded.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Backend } from './backend.js';

/** Splits a command line into argv: whitespace-separated, with "double" or 'single' quoted words. */
export function splitCommand(command: string): string[] {
  const words: string[] = [];
  for (const match of command.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g)) words.push(match[1]?.replace(/\\(.)/g, '$1') ?? match[2] ?? match[3]);
  return words;
}

// Argument keys that name a file or directory. Their string values become the receipt's paths; the
// policy also scans every other string argument, so a secret path under any key is still caught.
const PATH_KEY = /(?:^|[_-])(?:path|paths|file|files|filename|filepath|dir|dirs|directory|cwd|source|destination|target|uri)$/i;

export function pathsFromArgs(value: unknown, key = '', into = new Set<string>()): string[] {
  if (typeof value === 'string' && PATH_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, '$1_$2'))) into.add(value.startsWith('file://') ? decodeURIComponent(new URL(value).pathname) : value);
  else if (Array.isArray(value)) value.forEach((item) => pathsFromArgs(item, key, into));
  else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) pathsFromArgs(item, name, into);
  return [...into];
}

export async function connectUpstream(command: string): Promise<Backend> {
  const [executable, ...args] = splitCommand(command);
  if (!executable) throw new Error('--upstream needs a command, for example --upstream "npx -y @modelcontextprotocol/server-filesystem ."');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const client = new Client({ name: 'blackbox-receipts-proxy', version: '0.2.0' });
  try {
    await client.connect(new StdioClientTransport({ command: executable, args, cwd: process.cwd(), env, stderr: 'inherit' }));
  } catch (error) {
    throw new Error(`Could not start the upstream MCP server "${command}": ${error instanceof Error ? error.message : String(error)}`);
  }
  let known: Tool[] = [];
  const refresh = async () => {
    const all: Tool[] = [];
    let cursor: string | undefined;
    do { const page = await client.listTools(cursor ? { cursor } : {}); all.push(...page.tools); cursor = page.nextCursor; } while (cursor);
    known = all;
  };
  await refresh();
  return {
    label: `upstream: ${command}`,
    listTools: async (cursor) => {
      const page = await client.listTools(cursor ? { cursor } : {});
      if (!cursor) known = page.nextCursor ? known : page.tools;
      return page;
    },
    plan: async (name, args) => {
      if (!known.some((tool) => tool.name === name)) await refresh();
      if (!known.some((tool) => tool.name === name)) throw new Error(`Unknown tool: ${name} (the upstream server does not list it)`);
      return {
        paths: pathsFromArgs(args),
        permissions: [`upstream:${name}`],
        run: async () => {
          const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
          return { result, recorded: { content: result.content, structuredContent: result.structuredContent, isError: result.isError ?? false } };
        },
      };
    },
    close: () => client.close(),
  };
}
