// Receipt-gated merge. Every file a change set touches must be exactly what a signed write_file step
// produced: the receipt records the git blob id it wrote, and the working tree's blob must match the
// latest recorded write. Anything else is reported by name: an unrecorded change (a human edit, or an
// agent that wrote through some other tool) or a file changed after its recorded write.
import { execFileSync } from 'node:child_process';
import { byCodeUnits, sha256Hex, stableJson, type Receipt } from '@blackbox/receipts';

export type FileVerdict = { path: string; change: 'added' | 'modified' | 'deleted'; blob: string | null; step: number | null; ok: boolean; reason: string };
export type DiffAttestation = {
  kind: 'blackbox-diff-attestation';
  version: 1;
  base: string;
  head: string;
  sessionId: string;
  root: string;
  files: FileVerdict[];
  ok: boolean;
  createdAt: string;
  publicKey: string;
  signature: string;
};

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 50_000_000 });

function matches(path: string, pattern: string): boolean {
  if (pattern.endsWith('/**')) return path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2));
  return path === pattern;
}

/** Files changed between `base` and the working tree (committed or not), plus untracked files. */
export function changedFiles(cwd: string, base: string): { path: string; change: FileVerdict['change'] }[] {
  const tracked = git(cwd, ['diff', '--name-status', '--no-renames', '-z', base]).split('\0').filter(Boolean);
  const files: { path: string; change: FileVerdict['change'] }[] = [];
  for (let index = 0; index < tracked.length; index += 2) files.push({ path: tracked[index + 1], change: tracked[index] === 'A' ? 'added' : tracked[index] === 'D' ? 'deleted' : 'modified' });
  for (const path of git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) files.push({ path, change: 'added' });
  return files.sort((a, b) => byCodeUnits(a.path, b.path));
}

export function checkDiff(cwd: string, base: string, receipts: Receipt[], ignore: string[]): FileVerdict[] {
  // Latest successful recorded write per path, in step order.
  const written = new Map<string, { blob: string; step: number }>();
  for (const receipt of receipts) {
    if (receipt.tool !== 'write_file' || receipt.outcome !== 'ok') continue;
    for (const artifact of receipt.artifacts ?? []) written.set(artifact.path, { blob: artifact.blob, step: receipt.step });
  }
  return changedFiles(cwd, base).filter(({ path }) => !ignore.some((pattern) => matches(path, pattern))).map(({ path, change }) => {
    const recorded = written.get(path);
    if (change === 'deleted') return { path, change, blob: null, step: null, ok: false, reason: `unrecorded change: ${path} was deleted, and no signed step deletes files` };
    const blob = git(cwd, ['hash-object', '--', path]).trim();
    if (!recorded) return { path, change, blob, step: null, ok: false, reason: `unrecorded change: ${path}` };
    if (recorded.blob !== blob) return { path, change, blob, step: recorded.step, ok: false, reason: `${path} changed after its recorded write (step ${recorded.step} wrote ${recorded.blob.slice(0, 10)}, the file is now ${blob.slice(0, 10)})` };
    return { path, change, blob, step: recorded.step, ok: true, reason: `matches the write signed at step ${recorded.step}` };
  });
}

export function headOf(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD']).trim();
}

export function attestationDigest(attestation: Omit<DiffAttestation, 'signature'>): string {
  return sha256Hex(stableJson(attestation));
}

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JUnit for CI test reports. `label` (UNPINNED when the export's key was not pinned) ends the suite name. */
export function junit(files: FileVerdict[], base: string, sessionId: string, label?: string): string {
  const failures = files.filter((file) => !file.ok).length;
  const cases = files.map((file) => `    <testcase classname="blackbox.attest-diff" name="${xml(file.path)}">${file.ok ? '' : `\n      <failure message="${xml(file.reason)}">${xml(file.reason)}</failure>\n    `}</testcase>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="blackbox attest-diff ${xml(base)} (session ${xml(sessionId)})${label ? ` ${xml(label)}` : ''}" tests="${files.length}" failures="${failures}">\n${cases.join('\n')}\n  </testsuite>\n</testsuites>\n`;
}
