// The /recorder dashboard over a session recorded through the real MCP proxy before the server started
// (git log, read README.md, ls packages, a .env read the proxy denied, git show --stat). The tests tamper
// with and restore that throwaway store, and record one more real call while the page is open.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY, LIVE, PAGES, REPO, storeEnv } from './env.ts';
import { expectNoHorizontalScroll, logControls, test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';

const pad = (n: number) => String(n).padStart(2, '0');
const lamp = (page: Page, label: string) => page.locator('.rc-lamp').filter({ has: page.locator('.rc-lamp-label', { hasText: label }) });

type SessionBody = { sessionId: string; receipts: { step: number; hash: string; tool: string; outcome: string }[]; chain: { valid: boolean } };
async function session(page: Page): Promise<SessionBody> {
  const response = await page.request.get('/api/session');
  expect(response.ok()).toBe(true);
  return response.json();
}

test.describe('recorder: live session', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/recorder');
    await expect(page.locator('.rc-rec')).toContainText('Recording');
  });
  // A failed tamper test must not leave the shared store edited for the tests after it.
  test.afterEach(async ({ request }) => {
    const body = await (await request.get('/api/session')).json();
    if (body.tampered?.length) expect((await request.post('/api/restore')).ok()).toBe(true);
  });

  test('annunciator lamps and readouts come from the live store', async ({ page }) => {
    const body = await session(page);
    expect(body.chain.valid).toBe(true);
    const denied = body.receipts.find((receipt) => receipt.outcome === 'denied')!;
    await expect(lamp(page, 'Chain')).toContainText('Verified');
    await expect(lamp(page, 'Secret paths')).toContainText(`Touched · ${pad(denied.step)}`);
    await expect(lamp(page, 'No-secrets proof')).toContainText('Not run');
    await expect(lamp(page, 'Tamper test')).toContainText('Off');
    await expect(lamp(page, 'Walrus')).toContainText('Setup required');
    await expect(lamp(page, 'Walrus')).toContainText('WALRUS_PUBLISHER_URL');
    await expect(lamp(page, 'Zetaris')).toContainText('Setup required');
    await expect(lamp(page, 'Zetaris')).toContainText('ZETARIS_API_KEY');
    await expect(lamp(page, 'Meterless')).toContainText('Setup required');
    await expect(page.locator('.rc-master')).toHaveText('Master warning');
    const readouts = page.getByLabel('Readouts');
    await expect(readouts).toContainText(`Blocks${pad(body.receipts.length)}`);
    await expect(readouts).toContainText('Denied calls01');
    await expect(page.locator('.rc-rec code')).toHaveText(body.sessionId.slice(0, 8));
    await expect(page.locator('#tape .tape-mark')).toHaveCount(body.receipts.length);
    await expect(page.locator('#tape .tape-flag')).toContainText('Denied · .env');
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('recorder-live.png'), animations: 'disabled', fullPage: true });
  });

  test('names the session file it really reads (RECEIPTS_DIR), never .blackbox/ or the key folder', async ({ page }) => {
    // This server's RECEIPTS_DIR is a throwaway folder outside the repo (e2e/env.ts), so the label is its full path.
    const { RECEIPTS_DIR, BLACKBOX_KEY_DIR } = storeEnv(LIVE.dir);
    const file = join(RECEIPTS_DIR, 'session.jsonl');
    expect((await (await page.request.get('/api/session')).json()).source).toBe(file);
    await expect(page.locator('#tape .rc-note')).toHaveText(`Reads ${file} every 3 s`);
    const wiring = page.getByLabel('Wiring');
    await expect(wiring.locator('dt', { hasText: 'Store' }).locator('xpath=following-sibling::dd[1]')).toHaveText(file);
    await expect(page.locator('body')).not.toContainText('.blackbox/session.jsonl');
    await expect(page.locator('body')).not.toContainText(BLACKBOX_KEY_DIR);
    await expectNoHorizontalScroll(page);
  });

  test('show and hide the public key', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Show public key' });
    await toggle.click();
    await expect(page.getByLabel('Proxy public key')).toContainText('BEGIN PUBLIC KEY');
    await expect(page.getByRole('button', { name: 'Hide public key' })).toHaveAttribute('aria-expanded', 'true');
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: 'Hide public key' }).click();
    await expect(page.getByLabel('Proxy public key')).toHaveCount(0);
  });

  test('tape log: every row expands to its signed receipt and explains why', async ({ page }) => {
    const body = await session(page);
    const log = page.getByRole('list', { name: 'Tape log' });
    await expect(log.getByRole('listitem')).toHaveCount(body.receipts.length);
    const drawer = page.getByRole('dialog');
    for (const receipt of body.receipts) {
      const row = log.locator(`#block-${receipt.step}`);
      const toggle = row.locator('.rc-row-main');
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(row).toContainText(receipt.hash);
      const why = row.getByRole('button', { name: `Explain why · step ${pad(receipt.step)}` });
      if (receipt.outcome === 'denied') { await why.scrollIntoViewIfNeeded(); await page.screenshot({ path: test.info().outputPath('recorder-row-expanded.png'), animations: 'disabled' }); }
      await why.click();
      await expect(drawer).toContainText(`Explain why · step ${pad(receipt.step)}`);
      await expect(drawer).toContainText(receipt.outcome === 'denied' ? 'Policy violation' : 'Allowed');
      if (receipt.outcome === 'denied') {
        await expectNoHorizontalScroll(page);
        await page.screenshot({ path: test.info().outputPath('recorder-drawer-denied.png'), animations: 'disabled' });
      }
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(why).toBeFocused();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(why).toHaveCount(0);
    }
  });

  test('prove no secrets: fails at the denied read and explains it', async ({ page }) => {
    const body = await session(page);
    const denied = body.receipts.find((receipt) => receipt.outcome === 'denied')!;
    await page.getByRole('button', { name: 'Prove: no secrets read' }).click();
    await expect(lamp(page, 'No-secrets proof')).toContainText(`Fail · ${pad(denied.step)}`);
    const prove = page.locator('#prove');
    await expect(prove.getByRole('heading')).toHaveText(`Fail at block ${pad(denied.step)}`);
    await expect(prove).toContainText('.env*');
    await expect(page.locator(`#block-${denied.step} .rc-pill`)).toHaveText('Policy fail');
    await prove.getByRole('button', { name: `Explain why block ${pad(denied.step)} fails` }).click();
    await expect(page.getByRole('dialog')).toContainText(`Explain why · step ${pad(denied.step)}`);
    await page.screenshot({ path: test.info().outputPath('recorder-proof-fail.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Close the explanation' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('tamper test: edit a block on disk, see the chain break, re-verify, restore', async ({ page }) => {
    await page.getByRole('button', { name: 'Prove: no secrets read' }).click();
    await expect(lamp(page, 'No-secrets proof')).toContainText('Fail');
    await page.getByLabel('Block to tamper').selectOption('2');
    await page.getByRole('button', { name: 'Tamper', exact: true }).click();
    await expect(page.locator('.rc-notice')).toHaveText('Block 2 edited on disk. Verification now rejects its signature.');
    await expect(lamp(page, 'Chain')).toContainText('Broken · 02');
    await expect(lamp(page, 'Tamper test')).toContainText('Edited · 02');
    await expect(lamp(page, 'No-secrets proof')).toContainText('Stale');
    await expect(page.locator('.rc-rec')).toContainText('Tamper detected');
    await expect(page.locator('#block-2 .rc-pill')).toHaveText('Signature fails');
    await expect(page.locator('#block-3 .rc-pill')).toHaveText('Untrusted');
    await expect(page.locator('#tape .tape-flag').first()).toContainText('Signature fails · 02');
    await expect(page.getByLabel('Readouts').locator('.is-bad').first()).toContainText('Rejected');
    await page.screenshot({ path: test.info().outputPath('recorder-tampered.png'), animations: 'disabled', fullPage: true });

    const reverify = page.waitForResponse((response) => response.url().endsWith('/api/session') && response.ok());
    await page.getByRole('button', { name: 'Re-verify' }).click();
    await reverify;
    await expect(lamp(page, 'Chain')).toContainText('Broken · 02');

    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator('.rc-notice')).toHaveText('Restored block(s) 2 to their signed originals.');
    await expect(lamp(page, 'Chain')).toContainText('Verified');
    await expect(lamp(page, 'Tamper test')).toContainText('Off');
    await expect(page.getByRole('button', { name: 'Restore' })).toBeDisabled();
    await expect(lamp(page, 'No-secrets proof')).toContainText('Fail');
    await page.screenshot({ path: test.info().outputPath('recorder-restored.png'), animations: 'disabled' });
    expect((await session(page)).chain.valid).toBe(true);
  });

  test('Walrus upload stays Setup required without a publisher', async ({ page }) => {
    const panel = page.locator('.rc-control').filter({ hasText: 'Walrus storage' });
    await expect(panel.getByRole('heading')).toHaveText('Setup required');
    await expect(panel.getByRole('button', { name: 'Upload to Walrus' })).toBeDisabled();
  });

  test('nav links', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Recorder' }).getByRole('link', { name: 'Verify a pack' }).click();
    await expect(page).toHaveURL(/\/verify$/);
    await page.goBack();
    await page.getByRole('navigation', { name: 'Recorder' }).getByRole('link', { name: 'Overview' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/recorder');
    await page.getByRole('link', { name: 'Blackbox Receipts, home' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/recorder');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to the recorder' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#rc-main$/);
  });

  test('every "log" control works: each tape log row opens, and its Explain why opens the drawer', async ({ page }) => {
    const body = await session(page);
    const controls = await logControls(page);
    expect(controls.length, 'controls in or labelled as a log').toBe(body.receipts.length);
    for (const control of controls) {
      const element = page.locator('button:visible, a:visible, [role="button"]:visible').nth(control.index);
      await element.scrollIntoViewIfNeeded();
      await element.click();
      await expect(element).toHaveAttribute('aria-expanded', 'true');
      await element.locator('xpath=..').getByRole('button', { name: /^Explain why · step / }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await element.click();
      await expect(element).toHaveAttribute('aria-expanded', 'false');
    }
  });

  // Last in this file: it adds a receipt to the shared store.
  test('a new real tool call through the proxy appears on the live tape', async ({ page }) => {
    const before = (await session(page)).receipts.length;
    await expect(page.getByLabel('Readouts')).toContainText(`Blocks${pad(before)}`);
    await page.getByRole('button', { name: 'Prove: no secrets read' }).click();
    await expect(lamp(page, 'No-secrets proof')).toContainText('Fail');
    const call = spawnSync(process.execPath, [join(REPO, 'packages/proxy/dist/call.js'), 'read_file', '{"path":"package.json"}'], { cwd: REPO, env: { ...process.env, ...storeEnv(LIVE.dir) }, encoding: 'utf8' });
    expect(call.status, call.stderr).toBe(0);
    // The page polls every 3 s.
    await expect(page.getByLabel('Readouts')).toContainText(`Blocks${pad(before + 1)}`, { timeout: 8_000 });
    const row = page.locator(`#block-${before + 1}`);
    await expect(row).toContainText('read_file');
    await expect(row).toContainText('package.json');
    await expect(lamp(page, 'No-secrets proof')).toContainText('Stale');
    await expect(lamp(page, 'Chain')).toContainText('Verified');
    await row.locator('.rc-row-main').click();
    await row.getByRole('button', { name: `Explain why · step ${pad(before + 1)}` }).click();
    await expect(page.getByRole('dialog')).toContainText('package.json');
    await page.screenshot({ path: test.info().outputPath('recorder-new-call.png'), animations: 'disabled' });
  });
});

test.describe('recorder: empty store', () => {
  test('armed with nothing recorded: controls are disabled and say why', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${EMPTY.port}/recorder`);
    await expect(page.locator('.rc-empty')).toContainText('Recorder armed. Nothing recorded yet.');
    await expect(page.locator('.rc-empty code')).toHaveText('pnpm --filter @blackbox/proxy start');
    await expect(lamp(page, 'Chain')).toContainText('No data');
    await expect(lamp(page, 'Secret paths')).toContainText('No data');
    await expect(page.getByRole('button', { name: 'Tamper', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Restore' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Prove: no secrets read' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Upload to Walrus' })).toBeDisabled();
    await expect(page.locator('.rc-master')).toHaveText('No warnings');
    const reverify = page.waitForResponse((response) => response.url().endsWith('/api/session') && response.ok());
    await page.getByRole('button', { name: 'Re-verify' }).click();
    await reverify;
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('recorder-empty.png'), animations: 'disabled', fullPage: true });
  });
});

test.describe('recorder: a torn log line', () => {
  // A proxy killed mid-append leaves a half-written last line. The dashboard must say which line of which
  // file is damaged, not fail with a bare server error. Uses the empty store and empties it again after.
  test('the session API answers 409 naming the line, and the page shows it as an alert', async ({ page, problems }) => {
    problems.allow(new RegExp(`HTTP 409 GET http://127\\.0\\.0\\.1:${EMPTY.port}/api/session$`));
    problems.allow(/console error: Failed to load resource: the server responded with a status of 409/);
    const live = readFileSync(join(storeEnv(LIVE.dir).RECEIPTS_DIR, 'session.jsonl'), 'utf8').split('\n');
    const file = join(storeEnv(EMPTY.dir).RECEIPTS_DIR, 'session.jsonl');
    writeFileSync(file, `${live[0]}\n${live[1].slice(0, Math.floor(live[1].length / 2))}`);
    try {
      const response = await page.request.get(`http://127.0.0.1:${EMPTY.port}/api/session`);
      expect(response.status()).toBe(409);
      const body = await response.json();
      expect(body.corruptLine).toBe(2);
      expect(body.error).toMatch(/^session\.jsonl is corrupt at line 2: /);
      await page.goto(`http://127.0.0.1:${EMPTY.port}/recorder`);
      await expect(page.getByRole('alert').filter({ hasText: 'Could not load the session' })).toContainText('session.jsonl is corrupt at line 2');
      await expect(page.locator('.rc-empty')).toContainText('Session unavailable');
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: test.info().outputPath('recorder-torn-log.png'), animations: 'disabled', fullPage: true });
    } finally {
      writeFileSync(file, '');
    }
    const reverify = page.waitForResponse((response) => response.url().endsWith('/api/session') && response.ok());
    await page.getByRole('button', { name: 'Re-verify' }).click();
    await reverify;
    await expect(page.locator('.rc-empty')).toContainText('Recorder armed. Nothing recorded yet.');
  });
});

test.describe('recorder: requests from another site', () => {
  // A page on another origin (here the static site on another port, then a page under another host name) fires
  // the simple, preflight-free POSTs a CSRF attack would: restore an edited block, run a proof. The API must
  // refuse them, so the tamper stays visible; the dashboard's own requests keep working.
  test('cross-origin POSTs to /api/restore and /api/prove are refused, and the store is left as it was', async ({ page, problems }) => {
    problems.allow(new RegExp(`HTTP 403 POST http://127\\.0\\.0\\.1:${LIVE.port}/api/(restore|prove)$`));
    problems.allow(/console error: Failed to load resource: the server responded with a status of 403/);
    const api = `http://127.0.0.1:${LIVE.port}`;
    expect((await page.request.post(`${api}/api/tamper`, { data: { step: 2 } })).ok()).toBe(true);
    try {
      for (const attacker of [`http://127.0.0.1:${PAGES.port}${PAGES.base}/`, `http://blackbox.test:${PAGES.port}${PAGES.base}/`]) {
        await page.goto(attacker);
        const statuses = await page.evaluate(async (target) => {
          const out: string[] = [];
          for (const path of ['/api/restore', '/api/prove']) {
            const response = await fetch(`${target}${path}`, { method: 'POST', mode: 'no-cors' });
            out.push(response.type);
          }
          return out;
        }, api);
        expect(statuses).toEqual(['opaque', 'opaque']);
        const body = await (await page.request.get(`${api}/api/session`)).json();
        expect(body.tampered, `a request from ${attacker} undid the tamper`).toEqual([2]);
      }
      // What the attacker's request got, seen from the server side: a readable refusal.
      const refused = await page.request.post(`${api}/api/restore`, { headers: { 'Sec-Fetch-Site': 'cross-site', Origin: 'http://evil.example' } });
      expect(refused.status()).toBe(403);
      expect((await refused.json()).error).toContain('refused a cross-site request from http://evil.example');
    } finally {
      // Leave the shared store as the other tests expect it, without masking the assertion that failed.
      if ((await (await page.request.get(`${api}/api/session`)).json()).tampered?.length) await page.request.post(`${api}/api/restore`);
    }
    // The dashboard's own same-origin requests still go through.
    await page.goto('/recorder');
    await expect(lamp(page, 'Chain')).toContainText('Verified');
    await page.getByRole('button', { name: 'Prove: no secrets read' }).click();
    await expect(lamp(page, 'No-secrets proof')).toContainText('Fail');
  });
});

test.describe('recorder: opened under a non-loopback host name', () => {
  test('the local-only API refuses it and the page says so', async ({ page, problems }) => {
    // The middleware answers 403 for every API call; those responses are the behaviour under test.
    problems.allow(/HTTP 403 .*blackbox\.test:\d+\/api\//);
    problems.allow(/console error: Failed to load resource: the server responded with a status of 403/);
    await page.goto(`http://blackbox.test:${LIVE.port}/recorder`);
    await expect(page.getByRole('alert').filter({ hasText: 'Could not load the session' })).toContainText('local-only');
    await expect(lamp(page, 'Chain')).toContainText('No signal');
    await expect(page.locator('.rc-empty')).toContainText('Session unavailable');
    await expect(lamp(page, 'Zetaris')).toContainText('Check failed');
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('recorder-refused.png'), animations: 'disabled', fullPage: true });
  });
});
