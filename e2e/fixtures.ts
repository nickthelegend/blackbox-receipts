// Shared fixtures: every test fails on a console error, an uncaught page error or a failed same-origin
// request, and pages can be checked for horizontal scroll.
import { test as base, expect, type Page } from '@playwright/test';

type Problems = { list: string[]; allow: (pattern: RegExp) => void };

export const test = base.extend<{ problems: Problems }>({
  problems: [async ({ page }, use) => {
    const list: string[] = [];
    const allowed: RegExp[] = [];
    const origin = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };
    const sameOrigin = (url: string) => origin(url) === origin(page.url()) || /^http:\/\/(127\.0\.0\.1|localhost|blackbox\.test):/.test(url);
    page.on('console', (message) => { if (message.type() === 'error') list.push(`console error: ${message.text()} (${message.location().url})`); });
    page.on('pageerror', (error) => list.push(`page error: ${error.message}`));
    page.on('response', (response) => { if (response.status() >= 400 && sameOrigin(response.url())) list.push(`HTTP ${response.status()} ${response.request().method()} ${response.url()}`); });
    // A navigation started by a click cancels the old page's pending requests (net::ERR_ABORTED); that is not a failure.
    page.on('requestfailed', (request) => { const reason = request.failure()?.errorText ?? ''; if (sameOrigin(request.url()) && reason !== 'net::ERR_ABORTED') list.push(`request failed: ${request.method()} ${request.url()} ${reason}`); });
    await use({ list, allow: (pattern) => allowed.push(pattern) });
    const unexpected = list.filter((line) => !allowed.some((pattern) => pattern.test(line)));
    expect(unexpected, 'console errors, page errors or failed same-origin requests').toEqual([]);
  }, { auto: true }],
});

export { expect };

/** The page must not scroll sideways at its current viewport width. */
export async function expectNoHorizontalScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, `page is ${scroll}px wide in a ${width}px viewport`).toBeLessThanOrEqual(width);
}

/**
 * Every "log" control: a visible control whose label or accessible name contains "log" (log, tape log, log in…),
 * or one that sits inside a list named as a log (the tape log's rows and their Why buttons).
 */
export async function logControls(page: Page) {
  return page.locator('button:visible, a:visible, [role="button"]:visible').evaluateAll((elements) => elements
    .map((element, index) => {
      const own = `${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`.replace(/\s+/g, ' ').trim();
      const list = element.closest('ol, ul');
      const labelledBy = list?.getAttribute('aria-labelledby');
      const listName = list?.getAttribute('aria-label') ?? (labelledBy ? document.getElementById(labelledBy)?.textContent ?? '' : '');
      return { index, label: own, list: listName };
    })
    .filter((item) => /\blog\b/i.test(item.label) || /\blog\b/i.test(item.list)));
}
