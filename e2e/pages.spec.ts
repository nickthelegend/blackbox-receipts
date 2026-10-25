// The static Pages build (public/, served under /blackbox-receipts): the landing and /verify work with no
// server behind them, links carry the base path, and the recorder link points at the local setup instead.
import { PAGES } from './env.ts';
import { expectNoHorizontalScroll, test, expect } from './fixtures.ts';

const site = `http://127.0.0.1:${PAGES.port}${PAGES.base}`;

test.describe('static Pages build', () => {
  test('landing and /evidence: base-path links, tape log drawer and an exhibit check', async ({ page }) => {
    await page.goto(`${site}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Every tool call your agent makes/);
    await expectNoHorizontalScroll(page);
    // The header's short label fits a 375 px header; the closing call to action carries the long one.
    await expect(page.locator('header').getByRole('link', { name: 'Run it locally' })).toHaveAttribute('href', /#setup$/);
    await expect(page.getByRole('link', { name: 'Run the recorder locally' })).toHaveAttribute('href', /#setup$/);
    await expect(page.getByRole('link', { name: 'Open recorder' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Blackbox Receipts, home' })).toHaveAttribute('href', `${PAGES.base}/`);

    await expect(page.getByRole('link', { name: 'See the evidence' })).toHaveAttribute('href', `${PAGES.base}/evidence/`);
    await page.getByRole('link', { name: 'Play back a real run' }).click();
    await expect(page).toHaveURL(`${site}/evidence/#playback`);
    await expect(page.getByRole('link', { name: 'Blackbox Receipts, home' })).toHaveAttribute('href', `${PAGES.base}/`);
    const log = page.getByRole('list', { name: 'Tape log' });
    await log.scrollIntoViewIfNeeded();
    await log.getByRole('button', { name: /^Explain why step 3 / }).click();
    await expect(page.getByRole('dialog')).toContainText('Explain why · step 03');
    await page.keyboard.press('Escape');

    const inv = page.locator('#investigation');
    await inv.scrollIntoViewIfNeeded();
    await inv.getByRole('button', { name: 'Run the checks' }).click();
    await expect(inv.locator('.iv-stamp')).toHaveText('Fail');
    await page.screenshot({ path: test.info().outputPath('pages-landing.png'), animations: 'disabled' });

    await page.getByRole('link', { name: 'Verify a pack' }).last().click();
    await expect(page).toHaveURL(`${site}/verify/`);
  });

  test('/verify works offline from the static export', async ({ page }) => {
    await page.goto(`${site}/verify/`);
    await expect(page.getByRole('heading', { name: 'Check a pack in your browser.' })).toBeVisible();
    await page.getByRole('button', { name: /Agent skipped the README’s \.env request/ }).click();
    await expect(page.locator('.vf-badge')).toHaveText('PASS');
    await page.getByRole('button', { name: 'Flip one byte' }).click();
    await expect(page.locator('.vf-badge')).toHaveText('FAIL');
    await expectNoHorizontalScroll(page);
    await expect(page.getByRole('link', { name: 'Run it locally' })).toHaveAttribute('href', /#setup$/);
    await page.getByRole('link', { name: 'Blackbox Receipts, home' }).click();
    await expect(page).toHaveURL(`${site}/`);
  });
});
