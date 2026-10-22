// The offline /verify page: empty state, both sample packs, a one-byte tamper, loading a file by picker and by
// drop, and a file that is not a pack. After the page has loaded, no request may be made.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO } from './env.ts';
import { expectNoHorizontalScroll, logControls, test, expect } from './fixtures.ts';

const PASS_PACK = join(REPO, 'apps/web/app/verify/samples/agent-pass.json');

/** A real pack from a fresh proxy key: one read_file through the built one-shot bridge, then `cli pack`. */
function freshKeyPack(): { file: string; publicKey: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'blackbox-e2e-freshkey-'));
  writeFileSync(join(cwd, 'notes.md'), '# notes\n');
  const env = { ...process.env, RECEIPTS_DIR: join(cwd, 'store'), BLACKBOX_KEY_DIR: join(cwd, 'keys'), RECEIPTS_RESUME: '' };
  const call = spawnSync(process.execPath, [join(REPO, 'packages/proxy/dist/call.js'), '--new-session', 'read_file', '{"path":"notes.md"}'], { cwd, env, encoding: 'utf8' });
  expect(call.status, call.stderr).toBe(0);
  const packed = spawnSync(process.execPath, [join(REPO, 'packages/proxy/dist/cli.js'), 'pack', join(cwd, 'fresh-key-pack.json')], { cwd, env, encoding: 'utf8' });
  expect(packed.status, packed.stdout + packed.stderr).toBe(0);
  return { file: join(cwd, 'fresh-key-pack.json'), publicKey: readFileSync(join(cwd, 'keys/public-key.pem'), 'utf8') };
}

test.describe('verify', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/verify');
    await expect(page.getByRole('heading', { name: 'Check a pack in your browser.' })).toBeVisible();
  });

  test('empty state, then both real sample packs, offline', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await expect(page.getByLabel('No pack loaded')).toContainText('No pack loaded yet');
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('verify-empty.png'), animations: 'disabled' });

    await page.getByRole('button', { name: /Agent tried to read \.env/ }).click();
    await expect(page.locator('.vf-badge')).toHaveText('FAIL');
    await expect(page.locator('.vf-headline')).toContainText('step 3');
    await expect(page.locator('.vf-step')).toHaveCount(10);
    await expect(page.locator('.vf-step-warn')).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('verify-fail-sample.png'), animations: 'disabled', fullPage: true });

    await page.getByRole('button', { name: /Agent skipped the README’s \.env request/ }).click();
    await expect(page.locator('.vf-badge')).toHaveText('PASS');
    await expect(page.locator('.vf-checks li.is-ok')).toHaveCount(5);
    await expect(page.locator('.vf-step')).toHaveCount(14);
    await expect(page.locator('.vf-root')).toContainText('Merkle root');
    expect(requests, 'requests made after the page loaded').toEqual([]);
  });

  test('flip one byte breaks that step and makes the rest untrusted', async ({ page }) => {
    await page.getByRole('button', { name: /Agent skipped the README’s \.env request/ }).click();
    await page.getByLabel('Step to edit').selectOption('7');
    await page.getByRole('button', { name: 'Flip one byte' }).click();
    await expect(page.locator('.vf-badge')).toHaveText('FAIL');
    await expect(page.locator('.vf-edit')).toContainText("inside step 7's resultHash");
    await expect(page.locator('.vf-step-bad')).toHaveCount(1);
    await expect(page.locator('.vf-step-bad .vf-step-n')).toHaveText('07');
    await expect(page.locator('.vf-step-dim')).toHaveCount(7);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('verify-flipped.png'), animations: 'disabled', fullPage: true });
  });

  test('load a pack with the file picker and with "Load another pack"', async ({ page }) => {
    // A dropped or picked file is checked under the default pin, no-secrets-read/v2. This run was proven under
    // v1 on 2026-10-21, so it fails on the property until v1 is pinned explicitly.
    await page.locator('input[type=file]').setInputFiles(PASS_PACK);
    await expect(page.getByLabel('Pinned policy', { exact: true })).toHaveValue('no-secrets-read/v2');
    await expect(page.locator('.vf-badge')).toHaveText('FAIL');
    await expect(page.locator('.vf-meta')).toContainText('agent-pass.json');
    await page.getByLabel('Pinned policy', { exact: true }).selectOption('no-secrets-read/v1');
    await expect(page.locator('.vf-badge')).toHaveText('PASS (key not pinned)');
    await expect(page.locator('.vf-meta')).toContainText('policy no-secrets-read/v1');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Load another pack' }).click();
    await (await chooser).setFiles({ name: 'not-a-pack.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') });
    const alert = page.getByRole('alert').filter({ hasText: 'Could not verify.' });
    await expect(alert).toContainText('not-a-pack.json');
    await expect(page.locator('.vf-result')).toHaveCount(0);
  });

  test('drop a pack on the drop zone', async ({ page }) => {
    const text = readFileSync(PASS_PACK, 'utf8');
    const transfer = await page.evaluateHandle((content) => {
      const data = new DataTransfer();
      data.items.add(new File([content], 'dropped-pack.json', { type: 'application/json' }));
      return data;
    }, text);
    const zone = page.locator('.vf-drop');
    await zone.dispatchEvent('dragover', { dataTransfer: transfer });
    await expect(zone).toHaveClass(/is-drag/);
    await page.getByLabel('Pinned policy', { exact: true }).selectOption('no-secrets-read/v1');
    await zone.dispatchEvent('drop', { dataTransfer: transfer });
    await expect(zone).not.toHaveClass(/is-drag/);
    await expect(page.locator('.vf-badge')).toHaveText('PASS (key not pinned)');
    await expect(page.locator('.vf-meta')).toContainText('dropped-pack.json');
  });

  test('pinned policy: a sample pins v1, the policy it was recorded under; v2 rejects its v1 proof by name', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    const pin = page.getByLabel('Pinned policy', { exact: true });
    await expect(pin).toHaveValue('no-secrets-read/v2');
    await expect(page.locator('.vf-policy')).toContainText('.npmrc');
    await page.getByRole('button', { name: /Agent skipped the README’s \.env request/ }).click();
    await expect(pin).toHaveValue('no-secrets-read/v1');
    await expect(page.locator('.vf-badge')).toHaveText('PASS');
    await expect(page.locator('.vf-verdict')).toContainText('proven on 2026-10-21 under no-secrets-read/v1');
    await pin.selectOption('no-secrets-read/v2');
    await expect(page.locator('.vf-badge')).toHaveText('FAIL');
    await expect(page.locator('.vf-headline')).toContainText('Proof was made under policy "no-secrets-read/v1" (720836167c0f), not the pinned policy');
    await expect(page.locator('.vf-checks li.is-ok')).toHaveCount(4);
    await expect(page.locator('.vf-step-ok')).toHaveCount(14);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('verify-pinned-v2.png'), animations: 'disabled', fullPage: true });
    // A one-byte edit survives a change of pin: it is re-checked, still broken at its step.
    await pin.selectOption('no-secrets-read/v1');
    await expect(page.locator('.vf-badge')).toHaveText('PASS');
    await page.getByLabel('Step to edit').selectOption('5');
    await page.getByRole('button', { name: 'Flip one byte' }).click();
    await pin.selectOption('no-secrets-read/v2');
    await expect(page.locator('.vf-headline')).toHaveText('FAIL at step 5: Receipt contents were changed');
    await expect(page.locator('.vf-edit')).toContainText("inside step 5's resultHash");
    expect(requests, 'requests made after the page loaded').toEqual([]);
  });

  test('expected signer key: a pack from a fresh key is amber until pinned, red under another key, green under its own', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    const fresh = freshKeyPack();
    const signer = page.getByLabel('Expected signer key', { exact: true });
    await expect(signer).toHaveValue('none');
    await page.locator('input[type=file]').setInputFiles(fresh.file);
    // Unpinned: internally consistent, but anyone could have made that key.
    await expect(page.locator('.vf-badge')).toHaveText('PASS (key not pinned)');
    await expect(page.locator('.vf-badge')).toHaveClass(/vf-badge-warn/);
    await expect(page.locator('.vf-result')).toHaveClass(/vf-warn/);
    const fingerprint = (await page.locator('.vf-fingerprint').getAttribute('title')) ?? '';
    expect(fingerprint).toMatch(/^SHA-256 of the signer's Ed25519 key: [0-9a-f]{64}$/);
    await expect(page.locator('.vf-meta')).toContainText(`signer ${fingerprint.slice(-64, -48)}`);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('verify-unpinned.png'), animations: 'disabled', fullPage: true });
    // The committed demo key is not the key that signed this pack.
    await signer.selectOption('demo');
    await expect(page.locator('.vf-badge')).toHaveText('FAIL');
    await expect(page.locator('.vf-headline')).toHaveText('FAIL: Pack public key does not match the pinned key');
    await expectNoHorizontalScroll(page);
    // Its own key, pasted (with Windows line endings), pins it: green.
    await signer.selectOption('custom');
    await page.getByLabel('Signer public key (PEM)').fill(fresh.publicKey.replace(/\n/g, '\r\n'));
    await expect(page.locator('.vf-badge')).toHaveText('PASS');
    await expect(page.locator('.vf-badge')).toHaveClass(/vf-badge-ok/);
    await expect(page.locator('.vf-checks')).toContainText('matches the pinned key');
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('verify-pinned-key.png'), animations: 'disabled', fullPage: true });
    // Something that is not a key is said to be one, and nothing passes.
    await page.getByLabel('Signer public key (PEM)').fill('not a key');
    await expect(page.locator('.vf-badge')).toHaveText('FAIL');
    await expect(page.locator('.vf-headline')).toContainText('pinned key');
    // A sample pins the committed demo key, the key it was signed with, so it is green.
    await page.getByRole('button', { name: /Agent skipped the README’s \.env request/ }).click();
    await expect(signer).toHaveValue('demo');
    await expect(page.locator('.vf-badge')).toHaveText('PASS');
    expect(requests, 'requests made after the page loaded').toEqual([]);
  });

  test('a malformed pack (a null receipt) fails format at that step, with no page error', async ({ page }) => {
    const pack = JSON.parse(readFileSync(PASS_PACK, 'utf8'));
    pack.receipts.push(null);
    await page.locator('input[type=file]').setInputFiles({ name: 'null-receipt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) });
    await expect(page.locator('.vf-badge')).toHaveText('FAIL');
    await expect(page.locator('.vf-headline')).toHaveText('FAIL format at step 15: receipt is not an object');
    await expect(page.locator('.vf-step-bad .vf-step-n')).toHaveText('15');
    await expectNoHorizontalScroll(page);
  });

  test('header links', async ({ page }) => {
    await page.getByRole('link', { name: 'Open recorder' }).click();
    await expect(page).toHaveURL(/\/recorder$/);
    await page.goto('/verify');
    await page.getByRole('link', { name: 'Blackbox Receipts, home' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('has no "log" controls', async ({ page }) => {
    await page.getByRole('button', { name: /Agent skipped the README’s \.env request/ }).click();
    expect(await logControls(page)).toEqual([]);
  });
});
