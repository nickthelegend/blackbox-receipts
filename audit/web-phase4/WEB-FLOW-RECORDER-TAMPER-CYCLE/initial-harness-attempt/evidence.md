# WEB-FLOW-RECORDER-TAMPER-CYCLE: FAIL

Real Google Chrome 155.0.8059.85 via Playwright; 2026-10-25T21:51:45.003Z.

AUDIT.md expected cell as present in this worktree:

Selecting block 2 and clicking "Tamper" displays notice "Block 2 edited on disk. Verification now rejects its signature.", sets Chain lamp to "Broken · 02", Tamper lamp to "Edited · 02", No-secrets proof lamp to "Stale", status to "Tamper detected", block 2 pill to "Signature fails", block 3 pill to "Untrusted", and Readouts Rejected to "01"; clicking "Re-verify" executes GET /api/session and keeps broken state; clicking "Restore" displays notice "Restored block(s) 2 to their signed originals.", restores Chain lamp to "Verified", Tamper lamp to "Off", and disables Restore button. Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

The phase 4 user corrections override older wording for the evidence seal time, sample-fail headline, boundary console exception, pinned policy suffix, and non-pack error. See checks.json for exact expected/observed assertions.

1/1 exact checks passed. Error: expect(locator).toHaveText(expected) failed

Locator:  locator('.rc-lamp').filter({ has: locator('.rc-lamp-label').filter({ hasText: /^No-secrets proof$/ }) }).locator('b')
Expected: "Fail · 04"
Received: "Pass"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" locator('.rc-lamp').filter({ has: locator('.rc-lamp-label').filter({ hasText: /^No-secrets proof$/ }) }).locator('b') with timeout 5000ms
  - waiting for locator('.rc-lamp').filter({ has: locator('.rc-lamp-label').filter({ hasText: /^No-secrets proof$/ }) }).locator('b')
    2 × locator resolved to <b>Not run</b>
      - unexpected value "Not run"
    12 × locator resolved to <b>Pass</b>
       - unexpected value "Pass"

    at captureRawStack (/Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/lib/coreBundle.js:8588:17)
    at callMatcherAsStep (/Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/lib/matchers/expect.js:13310:57)
    at Object.toHaveText (/Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/lib/matchers/expect.js:13302:23)
    at /Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:146:124
    at async row (/Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:60:3)
    at async file:///Volumes/Extreme%20SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:143:2

Evidence: [checks](checks.json), [console](console.json), [network](network.json), [rendered text](screenshot.txt), [screenshot](screenshot.png), [trace](trace.zip).
