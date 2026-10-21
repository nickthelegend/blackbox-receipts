// Starts the Blackbox proxy as a child process and connects a real MCP client to it over stdio.
// Used by the one-shot `call` bridge, the tests and the overhead benchmark.
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export type ProxyOptions = { cwd?: string; env?: Record<string, string | undefined>; args?: string[]; name?: string };

/** The node arguments that run the proxy server: dist/server.js from the build, server.ts through tsx from source. */
export function proxyServerArgs(extra: string[] = []): string[] {
  const fromSource = fileURLToPath(import.meta.url).endsWith('.ts');
  const base = fromSource
    ? ['--conditions=source', '--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./server.ts', import.meta.url))]
    : [fileURLToPath(new URL('./server.js', import.meta.url))];
  return [...base, ...extra];
}

export async function connectProxy(options: ProxyOptions = {}): Promise<Client> {
  const env = Object.fromEntries(Object.entries({ ...process.env, ...options.env }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const client = new Client({ name: options.name ?? 'blackbox-client', version: '0.1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: proxyServerArgs(options.args), cwd: options.cwd ?? process.cwd(), env, stderr: 'inherit' }));
  return client;
}
