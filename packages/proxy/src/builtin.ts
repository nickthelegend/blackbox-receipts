// The default backend: read_file, read-only git and a restricted shell over the current workspace.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Backend, Planned } from './backend.js';
import { safeFilePath, safePath } from './store.js';

const execFileAsync = promisify(execFile);
const MAX_WRITE_BYTES = 1_000_000;

/** The id `git hash-object` gives these bytes (SHA-1 object format, no filters). */
export function gitBlobId(content: Buffer): string {
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

const tools: Tool[] = [
  { name: 'read_file', description: 'Read a UTF-8 text file from the current workspace. Secret paths are blocked and recorded.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Write a UTF-8 text file in the current workspace (creating folders as needed). The receipt records the file\'s git blob id, so `blackbox-receipts attest-diff` can check a diff against the log. Secret paths are blocked.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'git', description: 'Run read-only git status, diff, log, show (rev:path), or show_stat (files changed by one revision) in the current workspace.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'diff', 'log', 'show', 'show_stat'] }, args: { type: 'array', items: { type: 'string' } } }, required: ['action'] } },
  { name: 'shell', description: 'Run a shell command in the current workspace (only pwd, ls and cat). Secret reads and production targets are blocked.', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
];

/** Validates a call and works out which paths it touches, without running it. */
function planBuiltin(name: string, args: Record<string, unknown>): Omit<Planned, 'run'> & { run: () => Promise<unknown> } {
  if (name === 'read_file') {
    const target = safePath(z.string().parse(args.path));
    return { paths: [target.relativePath], permissions: ['workspace:file:read'], run: () => readFile(target.path, 'utf8') };
  }
  if (name === 'write_file') {
    const target = safePath(z.string().parse(args.path));
    const content = Buffer.from(z.string().parse(args.content), 'utf8');
    if (content.length > MAX_WRITE_BYTES) throw new Error(`write_file accepts at most ${MAX_WRITE_BYTES} bytes`);
    return { paths: [target.relativePath], permissions: ['workspace:file:write'], run: async () => {
      await mkdir(dirname(target.path), { recursive: true });
      await writeFile(target.path, content);
      return { written: target.relativePath, bytes: content.length, blob: gitBlobId(content) };
    } };
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

export const builtinBackend: Backend = {
  label: 'built-in workspace tools',
  listTools: async () => ({ tools }),
  plan: async (name, args) => {
    const planned = planBuiltin(name, args);
    return { ...planned, run: async () => {
      const output = await planned.run();
      const written = name === 'write_file' ? output as { written: string; blob: string } : null;
      return { result: { content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }] }, recorded: output, artifacts: written ? [{ path: written.written, blob: written.blob }] : undefined };
    } };
  },
};
