// Browser E2E: real Google Chrome (channel "chrome"), every run recorded (video, trace, screenshots).
// Three servers, all on 127.0.0.1 with throwaway stores (see env.ts):
//   3217  dashboard over a session recorded through the real MCP proxy (incl. a denied .env read)
//   3218  dashboard over an empty store
//   3219  the static Pages export from public/ under /blackbox-receipts
// Needs `pnpm build` and `pnpm build:pages -- --base-path /blackbox-receipts` first. Run: pnpm test:e2e
import { defineConfig } from '@playwright/test';
import { EMPTY, LIVE, PAGES } from './env.ts';

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  // The recorder tests tamper with and restore one shared store, so the run is serial.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    channel: 'chrome',
    baseURL: `http://127.0.0.1:${LIVE.port}`,
    video: 'on',
    trace: 'on',
    screenshot: 'on',
    // blackbox.test resolves to this machine, so a test can open the dashboard under a non-loopback host name.
    launchOptions: { args: ['--host-resolver-rules=MAP blackbox.test 127.0.0.1'] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: [
    { command: 'node_modules/.bin/tsx e2e/serve-dashboard.ts live', cwd: '..', url: `http://127.0.0.1:${LIVE.port}/api/session`, reuseExistingServer: false, timeout: 120_000, stdout: 'pipe' },
    { command: 'node_modules/.bin/tsx e2e/serve-dashboard.ts empty', cwd: '..', url: `http://127.0.0.1:${EMPTY.port}/api/session`, reuseExistingServer: false, timeout: 120_000, stdout: 'pipe' },
    { command: 'node_modules/.bin/tsx e2e/serve-pages.ts', cwd: '..', url: `http://127.0.0.1:${PAGES.port}${PAGES.base}/`, reuseExistingServer: false, timeout: 30_000, stdout: 'pipe' },
  ],
});
