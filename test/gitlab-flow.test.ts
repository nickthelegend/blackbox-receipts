import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Static checks on the Duo flow definition. GitLab validates the full schema when the YAML is pasted
// into AI > Flows; these guard the properties Blackbox relies on and the documented restricted fields.
const repoRoot = resolve(import.meta.dirname, '..');

test('Duo flow only reaches the workspace through the receipts bridge', () => {
  const flow = readFileSync(join(repoRoot, '.gitlab/duo/flows/blackbox-receipts.yaml'), 'utf8');
  const toolsets = [...flow.matchAll(/toolset:\s*\[([^\]]*)\]/g)].map((match) => match[1].split(',').map((item) => item.trim().replace(/"/g, '')));
  assert.ok(toolsets.length > 0);
  for (const tools of toolsets) for (const tool of tools) assert.ok(['run_command', 'create_merge_request_note', 'create_issue_note'].includes(tool), `unexpected tool ${tool}`);
  assert.match(flow, /node packages\/proxy\/dist\/call\.js --new-session/);
  assert.match(flow, /node packages\/proxy\/dist\/cli\.js export/);
  for (const forbidden of [/^name:/m, /^description:/m, /^\s+model:/m]) assert.doesNotMatch(flow, forbidden);
});
