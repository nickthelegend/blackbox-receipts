import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { storeSourceLabel } from '../packages/proxy/src/store.ts';

// /recorder names the file it reads. It must follow RECEIPTS_DIR and never point at the signing key's folder.
test('the recorder names the real session file: repo-relative, ~ for home, never the key folder', () => {
  const root = '/work/blackbox-receipts', home = '/Users/nick', keys = '/Users/nick/.blackbox';
  assert.equal(storeSourceLabel(join(root, '.blackbox/session.jsonl'), root, home, keys), '.blackbox/session.jsonl');
  assert.equal(storeSourceLabel(join(root, 'tmp/run-3/session.jsonl'), root, home, keys), 'tmp/run-3/session.jsonl');
  assert.equal(storeSourceLabel('/Users/nick/receipts/session.jsonl', root, home, keys), '~/receipts/session.jsonl');
  assert.equal(storeSourceLabel('/var/tmp/bb/session.jsonl', root, home, keys), '/var/tmp/bb/session.jsonl');
  // a sibling whose name only starts like the repo is outside it
  assert.equal(storeSourceLabel('/work/blackbox-receipts-old/session.jsonl', root, home, keys), '/work/blackbox-receipts-old/session.jsonl');
  for (const inKeys of [join(keys, 'session.jsonl'), join(keys, 'store/session.jsonl')]) {
    const label = storeSourceLabel(inKeys, root, home, keys);
    assert.ok(!label.includes('.blackbox') && !label.includes(keys), label);
    assert.match(label, /signing-key folder/);
  }
});
