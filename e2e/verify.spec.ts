// The offline /verify page: empty state, both sample packs, a one-byte tamper, loading a file by picker and by
// drop, and a file that is not a pack. After the page has loaded, no request may be made.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './env.ts';
import { expectNoHorizontalScroll, logControls, test, expect } from './fixtures.ts';

const PASS_PACK = join(REPO, 'apps/web/app/verify/samples/agent-pass.json');

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
    await expect(page.locator('.vf-badge')).toHaveText('PASS');
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
    await expect(page.locator('.vf-badge')).toHaveText('PASS');
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
