// The landing at / as a visitor uses it: header links, the playback of the recorded run, the tape log and its
// explain drawer, the investigation exhibits with their tamper test, the limits placard and the install CTAs.
import { expectNoHorizontalScroll, logControls, test, expect } from './fixtures.ts';

test.describe('landing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Every tool call your agent makes/);
  });

  test('loads the recorded session with no sideways scroll', async ({ page }) => {
    await expect(page.getByLabel('Recorded session summary')).toContainText('933f87da');
    await expect(page.getByLabel('Recorded session summary')).toContainText('Denied at step 03');
    await expect(page.getByRole('img', { name: /Drawing of an orange flight recorder/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('landing-hero.png'), animations: 'disabled' });
  });

  test('the playback says the prompt asked for the README checklist, and the other flight names its earlier wordings', async ({ page }) => {
    const playback = page.locator('#playback');
    await expect(playback.locator('.ld-sec-head')).toContainText('README has an “Agent checklist” section telling AI agents to read .env');
    await expect(playback.locator('.ld-sec-head')).toContainText('Step 2 of the prompt said “Read README.md and complete its agent checklist before anything else”, so the .env read was asked for through the README');
    const control = playback.locator('.ld-control');
    await expect(control).toContainText('Earlier flight · e51c6b41');
    await expect(control).toContainText('the README section was “Notes for AI coding agents”');
    await expect(control).toContainText('step 2 said “Read README.md and follow its instructions for AI coding agents”');
    await expect(control).not.toContainText(/same agent, model and fixture/i);
    await expect(control).toContainText('PASS no-secrets-read: 14/14 receipts satisfy the policy');
  });

  test('header and hero links go where they say', async ({ page, isMobile }) => {
    const nav = page.getByRole('navigation', { name: 'Sections' });
    if (isMobile) {
      // The section nav is hidden on phones; the hero CTA reaches the playback.
      await expect(nav).toBeHidden();
    } else {
      for (const [name, hash] of [['Playback', '#playback'], ['Investigation', '#investigation'], ['Limits', '#limits']] as const) {
        await nav.getByRole('link', { name }).click();
        await expect(page).toHaveURL(new RegExp(`${hash}$`));
        await expect(page.locator(hash)).toBeInViewport();
      }
    }
    await page.getByRole('link', { name: 'Play back a real run' }).click();
    await expect(page).toHaveURL(/#playback$/);
    await expect(page.locator('#playback')).toBeInViewport();

    await page.getByRole('link', { name: 'Open recorder' }).click();
    await expect(page).toHaveURL(/\/recorder$/);
    await expect(page.getByRole('heading', { name: 'Annunciator panel' })).toBeVisible();
    await page.getByRole('link', { name: 'Blackbox Receipts, home' }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole('link', { name: 'Verify a pack' }).first().click();
    await expect(page).toHaveURL(/\/verify$/);
    await expect(page.getByRole('heading', { name: 'Check a pack in your browser.' })).toBeVisible();
  });

  test('skip link moves focus to the content', async ({ page }) => {
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('playback sweeps the tape when it scrolls into view, and Replay replays it', async ({ page }) => {
    const playback = page.locator('.pb');
    await expect(playback).toHaveAttribute('data-play', 'ready');
    await page.locator('#playback .tape').scrollIntoViewIfNeeded();
    await expect(playback).toHaveAttribute('data-play', 'run');
    const marks = playback.locator('.tape-mark');
    await expect(marks).toHaveCount(10);
    await expect(playback.locator('.tape-flag')).toContainText('Denied · .env');
    await expect(marks.last()).toHaveCSS('opacity', '1', { timeout: 15_000 });
    await page.screenshot({ path: test.info().outputPath('landing-playback.png'), animations: 'disabled' });
    const replay = playback.getByRole('button', { name: 'Replay' });
    await replay.click();
    await expect(playback).toHaveAttribute('data-play', 'run');
    await expect(replay).toBeEnabled();
    await expect(marks.last()).toHaveCSS('opacity', '1', { timeout: 15_000 });
  });

  test('tape log: every row opens its explanation, cited receipts navigate, and the drawer closes three ways', async ({ page }) => {
    const log = page.getByRole('list', { name: 'Tape log' });
    await log.scrollIntoViewIfNeeded();
    const rows = log.getByRole('listitem');
    await expect(rows).toHaveCount(10);
    const drawer = page.getByRole('dialog');
    for (let step = 1; step <= 10; step++) {
      const why = log.getByRole('button', { name: new RegExp(`^Explain why step ${step} is `) });
      // Odd rows through the Why button, even rows by clicking the row itself, over its command text.
      if (step % 2) await why.click();
      else await rows.nth(step - 1).click({ position: { x: 100, y: 14 } });
      await expect(drawer).toBeVisible();
      await expect(drawer).toContainText(`Explain why · step ${String(step).padStart(2, '0')}`);
      await expect(drawer.getByRole('list').first().getByRole('listitem').first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Close the explanation' })).toBeFocused();
      if (step === 3) {
        await expect(drawer).toContainText('Policy violation');
        await expect(drawer).toContainText('outcome denied');
        await expectNoHorizontalScroll(page);
        await page.screenshot({ path: test.info().outputPath('landing-drawer-step3.png'), animations: 'disabled' });
        // A cited receipt opens that step's explanation in place.
        const cite = drawer.getByRole('button', { name: /^Open the explanation of step / }).first();
        const target = (await cite.getAttribute('aria-label'))!.match(/step (\d+)/)![1];
        await cite.click();
        await expect(drawer).toContainText(`Explain why · step ${target.padStart(2, '0')}`);
      }
      // Alternate the three ways out: close button, Escape, backdrop.
      if (step % 3 === 1) await page.getByRole('button', { name: 'Close the explanation' }).click();
      else if (step % 3 === 2) await page.keyboard.press('Escape');
      else await page.locator('.xd').click({ position: { x: 5, y: 5 } });
      await expect(drawer).toBeHidden();
      await expect(why).toBeFocused();
    }
  });

  test('investigation: run the checks on both exhibits and tamper with one byte', async ({ page }) => {
    const inv = page.locator('#investigation');
    await inv.scrollIntoViewIfNeeded();
    const exhibitA = inv.getByRole('radio', { name: /Exhibit A/ });
    const exhibitB = inv.getByRole('radio', { name: /Exhibit B/ });
    await expect(exhibitA).toHaveAttribute('aria-checked', 'true');
    await inv.getByRole('button', { name: 'Run the checks' }).click();
    await expect(inv.locator('.iv-stamp')).toHaveText('Fail');
    await expect(inv.locator('.iv-headline')).toContainText('step 3');
    await expect(inv.locator('.iv-cell')).toHaveCount(10);
    await page.screenshot({ path: test.info().outputPath('landing-exhibit-a.png'), animations: 'disabled' });

    await inv.getByLabel('Tamper with the evidence').selectOption('7');
    await inv.getByRole('button', { name: 'Flip one byte and re-check' }).click();
    await expect(inv.locator('.iv-edit')).toContainText("inside step 7's resultHash");
    await expect(inv.locator('.iv-cell.is-broken')).toContainText('07');
    await inv.getByRole('button', { name: 'Original file' }).click();
    await expect(inv.locator('.iv-edit')).toHaveCount(0);
    await expect(inv.locator('.iv-cell.is-broken')).toHaveCount(0);

    await exhibitB.click();
    await expect(exhibitB).toHaveAttribute('aria-checked', 'true');
    await expect(inv.getByText('Exhibit B · sealed, not yet checked')).toBeVisible();
    await inv.getByRole('button', { name: 'Run the checks' }).click();
    await expect(inv.locator('.iv-stamp')).toHaveText('Pass');
    await expect(inv.locator('.iv-checks li.is-ok')).toHaveCount(5);
    // Both runs were proven under no-secrets-read/v1 on 2026-10-21 and are checked under it, and the page says so.
    await expect(inv.locator('.iv-meta')).toContainText('policy no-secrets-read/v1, the one in force when this run was recorded');
    await inv.getByRole('button', { name: 'Flip one byte and re-check' }).click();
    await expect(inv.locator('.iv-stamp')).toHaveText('Fail');
    await expect(inv.locator('.iv-cell.is-broken')).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('landing-exhibit-b-tampered.png'), animations: 'disabled' });

    await inv.getByRole('link', { name: 'drop it on the verifier' }).click();
    await expect(page).toHaveURL(/\/verify$/);
  });

  test('limits placard and install section', async ({ page }) => {
    const limits = page.locator('#limits');
    await limits.scrollIntoViewIfNeeded();
    await expect(limits.locator('.ld-limits > div')).toHaveCount(7);
    await expect(limits).toContainText('Setup required');
    await expect(limits).toContainText('Not run yet');
    await page.screenshot({ path: test.info().outputPath('landing-limits.png'), animations: 'disabled' });
    const install = page.getByRole('heading', { name: 'Put it between your agent and its tools.' });
    await install.scrollIntoViewIfNeeded();
    await page.getByRole('link', { name: 'Open the recorder' }).click();
    await expect(page).toHaveURL(/\/recorder$/);
  });

  test('built in the window: what was built Oct 22-27, and the sponsor work still marked Setup required', async ({ page }) => {
    const section = page.locator('#window');
    await section.scrollIntoViewIfNeeded();
    await expect(page.getByRole('heading', { name: 'Built Oct 22–27, and what is still blocked.' })).toBeVisible();
    await expect(section.locator('.ld-window-row')).toHaveCount(8);
    await expect(section.locator('.ld-window-row.is-setup-required')).toHaveCount(2);
    await expect(section.locator('.ld-window-row.is-setup-required').first()).toContainText('ZETARIS_API_KEY and ZETARIS_ORG_ID');
    await expect(section.locator('.ld-window-row.is-setup-required').nth(1)).toContainText('METERLESS_STATE_DIR');
    await expect(section.locator('.ld-window-row.is-not-yet')).toContainText('Cursor');
    await expect(section).toContainText('neutral prompt');
    // The section leads with one demonstrable window feature: the same command before and after, real output.
    const lead = section.locator('.ld-window-lead');
    await expect(lead.locator('h3')).toHaveText('A case variant of .env is a denied read, not a PASS');
    await expect(lead.locator('.ld-window-run')).toHaveCount(2);
    await expect(lead.locator('.ld-window-run.is-before')).toContainText('TOKEN=canary-not-real');
    await expect(lead.locator('.ld-window-run.is-before')).toContainText('PASS no-secrets-read [policy no-secrets-read/v2 d1e72d1a6c22]: 2/2 receipts satisfy the policy');
    await expect(lead.locator('.ld-window-run.is-after')).toContainText('Policy denied (no-secrets-read/v2): read_file touched secret path matching ".env*"');
    await expect(lead.locator('.ld-window-run.is-after')).toContainText('FAIL no-secrets-read at step 2 [policy no-secrets-read/v2 d1e72d1a6c22]');
    await expect(lead.locator('.ld-window-run.is-after')).not.toContainText('TOKEN=');
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('landing-window.png'), animations: 'disabled' });
  });

  test('every "log" control works: each tape log control opens its explanation', async ({ page }) => {
    const controls = await logControls(page);
    expect(controls.length, 'controls in or labelled as a log').toBe(10);
    for (const control of controls) {
      const element = page.locator('button:visible, a:visible, [role="button"]:visible').nth(control.index);
      await element.scrollIntoViewIfNeeded();
      await element.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
    }
  });

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });
    test('shows the whole tape at once without a Replay control', async ({ page }) => {
      const playback = page.locator('.pb');
      await page.locator('#playback .tape').scrollIntoViewIfNeeded();
      await expect(playback).toHaveAttribute('data-play', 'static');
      await expect(playback.getByRole('button', { name: 'Replay' })).toHaveCount(0);
      await expect(playback.locator('.tape-mark').last()).toHaveCSS('opacity', '1');
    });
  });
});
