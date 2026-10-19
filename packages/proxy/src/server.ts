import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { addReceipt, isSecretPath, resetSession, safeFilePath, safePath } from './store.js';

const execFileAsync = promisify(execFile);
const server = new Server({ name: 'blackbox-receipts-proxy', version: '0.1.0' }, { capabilities: { tools: {} } });
const toolList = [
  { name: 'read_file', description: 'Read a UTF-8 text file from the current workspace. Secret paths are blocked and recorded.', inputSchema: { path: z.string() } },
  { name: 'git', description: 'Run read-only git status, diff, log, or show in the current workspace.', inputSchema: { action: z.enum(['status', 'diff', 'log', 'show']), args: z.array(z.string()).default([]) } },
  { name: 'shell', description: 'Run a shell command in the current workspace. Secret reads and production targets are blocked.', inputSchema: { command: z.string() } },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList.map(({ name, description, inputSchema }) => ({ name, description, inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(inputSchema).map(([key, schema]) => [key, { type: key === 'args' ? 'array' : 'string' }])), required: name === 'git' ? ['action'] : name === 'read_file' ? ['path'] : ['command'] } })) }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: input = {} } = request.params;
  const args = input as Record<string, unknown>;
  let output: unknown;
  let paths: string[] = [];
  let secretsAccessed = false;
  let permissions: string[] = [];
  try {
    if (name === 'read_file') {
      const target = safePath(z.string().parse(args.path));
      paths = [target.relativePath];
      permissions = ['workspace:file:read'];
      if (isSecretPath(target.relativePath)) { secretsAccessed = true; throw new Error('Policy denied access to secret path'); }
      output = await readFile(target.path, 'utf8');
    } else if (name === 'git') {
      const action = z.enum(['status', 'diff', 'log', 'show']).parse(args.action);
      const requested = z.array(z.string()).parse(args.args ?? []);
      permissions = ['workspace:git:read'];
      if (action === 'status' && requested.length) throw new Error('git status does not accept additional arguments');
      if (action === 'log' && requested.length) throw new Error('git log does not accept additional arguments');
      if (action === 'diff') {
        if (!requested.length || requested.some((path) => path.startsWith('-') || /[*?\[\]]/.test(path))) throw new Error('git diff requires explicit, literal file paths');
        paths = requested.map((path) => safeFilePath(path).relativePath);
      }
      if (action === 'show') {
        if (requested.length !== 1 || !requested[0].includes(':') || /[*?\[\]]/.test(requested[0])) throw new Error('git show requires one revision:path argument');
        const path = requested[0].split(':').at(-1)!;
        paths = [safeFilePath(path).relativePath];
      }
      if (paths.some(isSecretPath)) { secretsAccessed = true; throw new Error('Policy denied git access to a secret path'); }
      const gitArgs: Record<string, string[]> = {
        status: ['status', '--short'],
        diff: ['diff', '--', ...paths],
        log: ['log', '-n', '20', '--oneline'],
        show: ['show', requested[0]],
      };
      output = (await execFileAsync('git', gitArgs[action], { cwd: process.cwd(), maxBuffer: 2_000_000 })).stdout;
    } else if (name === 'shell') {
      const command = z.string().parse(args.command);
      const tokens = command.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map((token) => token.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')) ?? [];
      const executable = tokens.shift();
      if (!executable || !['pwd', 'ls', 'cat'].includes(executable) || tokens.some((token) => /[;&|><$`*?\[\]]/.test(token))) throw new Error('Shell allows only pwd, ls, and cat with direct arguments');
      if (executable === 'pwd' && tokens.length) throw new Error('pwd does not accept additional arguments');
      const candidates = executable === 'ls' ? tokens.filter((token) => !token.startsWith('-')) : tokens.filter((token) => token !== '--');
      const checkedPaths = candidates.length ? candidates : executable === 'ls' ? ['.'] : [];
      if (executable === 'ls' && tokens.some((token) => token.startsWith('-') && !['-a', '-l', '-la', '-al', '--'].includes(token))) throw new Error('ls allows only -a and -l options');
      if (executable === 'cat' && tokens.some((token) => token.startsWith('-') && token !== '--')) throw new Error('cat options are not allowed');
      permissions = ['workspace:shell:execute'];
      for (const candidate of checkedPaths) {
        const target = safePath(candidate);
        paths.push(target.relativePath);
        if (isSecretPath(target.relativePath)) secretsAccessed = true;
      }
      if (secretsAccessed) throw new Error('Policy denied shell access to a secret path');
      if (tokens.some((token) => /\b(prod(?:uction)?|mainnet)\b/i.test(token))) throw new Error('Policy denied production target');
      permissions = ['workspace:shell:execute'];
      const result = await execFileAsync(executable, tokens, { cwd: process.cwd(), maxBuffer: 2_000_000, timeout: 30_000 });
      output = { stdout: result.stdout, stderr: result.stderr };
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
    await addReceipt(name, args, output, paths, secretsAccessed, permissions);
    return { content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await addReceipt(name, args, { error: message }, paths, secretsAccessed, permissions);
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
});

const transport = new StdioServerTransport();
await resetSession();
await server.connect(transport);
