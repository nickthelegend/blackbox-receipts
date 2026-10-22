import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { repoRoot } from './fixtures/run.ts';

// Before the first public push: environment files, recordings and Playwright output must never be
// committable by accident, wherever they land in the tree. .env.example stays tracked.
function ignored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch (error) {
    if ((error as { status: number }).status === 1) return false;
    throw error;
  }
}

test('gitignore: env files, videos and Playwright output are ignored anywhere; .env.example is not', () => {
  const mustIgnore = ['.env', '.env.local', '.env.production', 'apps/web/.env.production.local', 'demo.mp4', 'docs/take-2.mov', 'e2e/test-results/x/video.webm', 'clip.webm', 'test-results/x', 'playwright-report/index.html', 'apps/web/test-results/x'];
  assert.deepEqual(mustIgnore.filter((path) => !ignored(path)), [], 'these paths are not ignored');
  for (const path of ['.env.example', 'apps/web/.env.example']) assert.equal(ignored(path), false, `${path} must stay committable`);
  // Nothing already tracked is matched by the ignore rules.
  assert.equal(execFileSync('git', ['ls-files', '-ci', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8' }), '');
});
