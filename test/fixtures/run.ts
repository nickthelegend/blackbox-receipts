// Runs a repo script (TypeScript, through tsx) as a real subprocess and captures its exit code and output.
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dirname, '../..');
const tsx = import.meta.resolve('tsx');

export function runScript(script: string, cwd: string, args: string[], env: Record<string, string | undefined> = {}): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, ['--conditions=source', '--import', tsx, join(repoRoot, script), ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { code: failure.status, out: failure.stdout + failure.stderr };
  }
}
