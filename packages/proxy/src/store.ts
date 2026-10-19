import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPublicKey } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createReceipt, generateSigningKey, type Receipt, type Witness, sha256 } from '@blackbox/receipts';

const currentDirectory = process.cwd();
const monorepoRoot = existsSync(resolve(currentDirectory, 'apps/web/package.json')) && existsSync(resolve(currentDirectory, 'packages/proxy/package.json'))
  ? currentDirectory
  : existsSync(resolve(currentDirectory, '../../apps/web/package.json')) && existsSync(resolve(currentDirectory, '../../packages/proxy/package.json'))
    ? resolve(currentDirectory, '../..')
    : currentDirectory;
export const workspaceRoot = monorepoRoot;
export const dataDir = resolve(monorepoRoot, process.env.RECEIPTS_DIR ?? '.blackbox');
const sessionFile = resolve(dataDir, 'session.jsonl');
// Raw tool arguments: the private witness for property proofs. Never served to the dashboard or included in proofs.
const witnessFile = resolve(dataDir, 'witness.jsonl');
const keyFile = resolve(dataDir, 'signing-key.pem');
const publicKeyFile = resolve(dataDir, 'public-key.pem');
// RECEIPTS_RESUME=1 appends to the existing session instead of starting a new one. One-shot MCP clients
// (such as the `call` bridge used by GitLab Duo flows) start a proxy per tool call and rely on this.
export const resumeSession = process.env.RECEIPTS_RESUME === '1';
function lastSessionId(): string | undefined {
  try {
    const last = readFileSync(sessionFile, 'utf8').trim().split('\n').filter(Boolean).at(-1);
    return last ? (JSON.parse(last) as Receipt).sessionId : undefined;
  } catch { return undefined; }
}
export const sessionId = process.env.RECEIPTS_SESSION_ID ?? (resumeSession ? lastSessionId() : undefined) ?? randomUUID();

export async function signingKeys() {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  if (process.env.RECEIPTS_SIGNING_KEY) {
    const privateKey = process.env.RECEIPTS_SIGNING_KEY;
    return { privateKey, publicKey: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString() };
  }
  try {
    const [privateKey, publicKey] = await Promise.all([readFile(keyFile, 'utf8'), readFile(publicKeyFile, 'utf8')]);
    return { privateKey, publicKey };
  } catch {
    const keys = generateSigningKey();
    await Promise.all([writeFile(keyFile, keys.privateKey, { mode: 0o600 }), writeFile(publicKeyFile, keys.publicKey, { mode: 0o644 })]);
    return keys;
  }
}

export async function loadReceipts(): Promise<Receipt[]> {
  try {
    const lines = (await readFile(sessionFile, 'utf8')).trim().split('\n').filter(Boolean);
    return lines.map((line) => JSON.parse(line) as Receipt);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function loadWitnesses(): Promise<Witness[]> {
  try {
    const lines = (await readFile(witnessFile, 'utf8')).trim().split('\n').filter(Boolean);
    return lines.map((line) => JSON.parse(line) as Witness);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function addReceipt(tool: string, args: unknown, result: unknown, paths: string[], secretsAccessed: boolean, permissions: string[], approvedBy: string | null = null) {
  const receipts = await loadReceipts();
  const keys = await signingKeys();
  const receipt = createReceipt({
    sessionId, step: receipts.filter((item) => item.sessionId === sessionId).length + 1,
    timestamp: new Date().toISOString(), tool, argsHash: sha256(JSON.stringify(args)), paths,
    secretsAccessed, permissions, cost: null, approver: approvedBy,
    resultHash: sha256(JSON.stringify(result)), previousHash: receipts.at(-1)?.hash ?? null,
  }, keys.privateKey);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await appendFile(witnessFile, `${JSON.stringify({ sessionId, step: receipt.step, args } satisfies Witness)}\n`, { mode: 0o600 });
  await appendFile(sessionFile, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  return receipt;
}

export async function resetSession() {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await Promise.all([writeFile(sessionFile, '', { mode: 0o600 }), writeFile(witnessFile, '', { mode: 0o600 }), rm(tamperBackupFile, { force: true })]);
}

// Tamper demonstration. The original line of every edited block is kept here, keyed by the receipt's
// stored hash (which the edit leaves alone), so `restoreSession` can undo it without dropping blocks
// the proxy appended after the tamper.
const tamperBackupFile = resolve(dataDir, 'tamper-backup.json');
type TamperBackup = Record<string, { step: number; line: string }>;

async function loadTamperBackup(): Promise<TamperBackup> {
  try { return JSON.parse(await readFile(tamperBackupFile, 'utf8')) as TamperBackup; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

/** Steps currently edited on disk by the tamper demonstration, in log order. */
export async function tamperedSteps(): Promise<number[]> {
  return Object.values(await loadTamperBackup()).map(({ step }) => step).sort((a, b) => a - b);
}

/** Edits the tool name of the block with this step in the current log. Returns the edited step. */
export async function tamperReceipt(step: number): Promise<number> {
  const lines = (await readFile(sessionFile, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  if (!lines.length) throw new Error('Record a real tool call before running the tamper demonstration.');
  const index = lines.findIndex((line) => (JSON.parse(line) as Receipt).step === step);
  if (index === -1) throw new Error(`There is no block ${step} in the current log (it has ${lines.length}).`);
  const entry = JSON.parse(lines[index]) as Receipt;
  const backup = await loadTamperBackup();
  backup[entry.hash] ??= { step: entry.step, line: lines[index] };
  if (!entry.tool.endsWith('-edited')) entry.tool = `${entry.tool}-edited`;
  lines[index] = JSON.stringify(entry);
  await writeFile(tamperBackupFile, JSON.stringify(backup, null, 2), { mode: 0o600 });
  await writeFile(sessionFile, `${lines.join('\n')}\n`, { mode: 0o600 });
  return entry.step;
}

/** Puts back the original line of every tampered block. Returns the restored steps. */
export async function restoreSession(): Promise<number[]> {
  const backup = await loadTamperBackup();
  if (!Object.keys(backup).length) throw new Error('Nothing to restore: no block has been tampered with.');
  const lines = (await readFile(sessionFile, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const restored: number[] = [];
  const next = lines.map((line) => {
    const original = backup[(JSON.parse(line) as Receipt).hash];
    if (!original) return line;
    restored.push(original.step);
    return original.line;
  });
  await writeFile(sessionFile, next.length ? `${next.join('\n')}\n` : '', { mode: 0o600 });
  await rm(tamperBackupFile, { force: true });
  return restored;
}

export function safePath(input: string): { path: string; relativePath: string } {
  const path = resolve(process.cwd(), input);
  let checkedPath = path;
  try { checkedPath = realpathSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const relativePath = relative(process.cwd(), checkedPath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error('Path must stay inside the current working directory');
  return { path: checkedPath, relativePath: relativePath.split(sep).join('/') };
}

export function safeFilePath(input: string): { path: string; relativePath: string } {
  const target = safePath(input);
  if (existsSync(target.path) && !statSync(target.path).isFile()) throw new Error('Path must identify one file');
  return target;
}

export function isSecretPath(path: string) {
  const normalized = path.replaceAll('\\', '/').split(':').at(-1) ?? path;
  return normalized.split('/').some((part) => part === 'secrets' || part === '.blackbox' || part === '.env' || part.startsWith('.env.')) || /(^|\/)(id_rsa|id_ed25519|credentials\.json|signing-key\.pem)$/i.test(normalized);
}
