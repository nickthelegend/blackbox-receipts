import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './fixtures/run.ts';

// The GitLab pipeline builds once and hands the packages' dist folders to the later jobs as artifacts. The
// test job typechecks apps/web, which imports every workspace package through its built types
// (packages/<name>/dist/index.d.ts). A package whose dist is not in the build artifacts makes the first
// pipeline red with TS2307, so every built workspace package must be listed.

/** The `paths:` list under the `build:` job's `artifacts:` in .gitlab-ci.yml. */
function buildArtifactPaths(yaml: string): string[] {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => line === 'build:');
  assert.ok(start >= 0, '.gitlab-ci.yml has no top-level build job');
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line));
  const job = lines.slice(start, end < 0 ? undefined : end);
  const artifacts = job.findIndex((line) => /^\s+artifacts:\s*$/.test(line));
  assert.ok(artifacts >= 0, 'the build job declares no artifacts');
  const paths = job.findIndex((line, index) => index > artifacts && /^\s+paths:\s*$/.test(line));
  const out: string[] = [];
  for (const line of job.slice(paths + 1)) {
    if (/^\s+#/.test(line)) continue;
    const item = line.match(/^\s+-\s+(\S+)\s*$/);
    if (!item) break;
    out.push(item[1].replace(/\/$/, ''));
  }
  return out;
}

test('gitlab ci: the build job hands every built workspace package dist to the test job', () => {
  const yaml = readFileSync(join(repoRoot, '.gitlab-ci.yml'), 'utf8');
  const artifacts = buildArtifactPaths(yaml);
  const built = readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(repoRoot, 'packages', entry.name, 'package.json')))
    .filter((entry) => Boolean(JSON.parse(readFileSync(join(repoRoot, 'packages', entry.name, 'package.json'), 'utf8')).scripts?.build))
    .map((entry) => `packages/${entry.name}/dist`)
    .sort();
  assert.ok(built.includes('packages/zetaris/dist'), 'expected packages/zetaris to be a built workspace package');
  assert.deepEqual(built.filter((dist) => !artifacts.includes(dist)), [], `build artifacts ${JSON.stringify(artifacts)} miss a package the test job typechecks against`);
  // The test job runs typecheck (which needs those types) without building again.
  const testJob = yaml.slice(yaml.indexOf('\ntest:\n'), yaml.indexOf('\nverify:live-session:'));
  assert.match(testJob, /needs: \[build\]/);
  assert.match(testJob, /pnpm typecheck/);
});

// The receipt gate must not run the code under review: a pull/merge request that edits checkDiff or the
// gate script would otherwise certify itself. Both CI configs build the gate from the base commit in a
// separate worktree and run that copy's script against the request's checkout.
test('ci: the receipt gate is built and run from the base commit, not from the request head', () => {
  const github = readFileSync(join(repoRoot, '.github/workflows/attest-diff.yml'), 'utf8');
  const gitlab = readFileSync(join(repoRoot, '.gitlab-ci.yml'), 'utf8');
  const gitlabJob = gitlab.slice(gitlab.indexOf('\nverify:attest-diff:'), gitlab.indexOf('\n', gitlab.indexOf('junit: attest-diff/attest-diff.xml')));
  for (const [name, config, base] of [['github', github, '${{ github.event.pull_request.base.sha }}'], ['gitlab', gitlabJob, '$CI_MERGE_REQUEST_DIFF_BASE_SHA']] as const) {
    assert.ok(config.includes(`git worktree add --detach "$GATE" "${base}"`), `${name}: no worktree at the base commit`);
    assert.match(config, /cd "\$GATE" && pnpm install --frozen-lockfile/, `${name}: the gate is not installed in the base worktree`);
    assert.ok(config.includes(`bash "$GATE/scripts/ci/attest-diff-pr.sh" "${base}" attest-diff`), `${name}: the gate script does not come from the base worktree`);
    assert.doesNotMatch(config, /^\s*-?\s*(?:run: )?bash scripts\/ci\/attest-diff-pr\.sh/m, `${name}: still runs the request's own gate script`);
  }
  assert.doesNotMatch(gitlabJob, /needs: \[build\]/, 'gitlab: the gate job must not use the request head build artifacts');
});
