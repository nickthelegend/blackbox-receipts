# WEB-PAGE-VERIFY-ERROR: FAIL

Real Google Chrome 155.0.8059.85 via Playwright; 2026-10-25T21:51:33.089Z.

AUDIT.md expected cell as present in this worktree:

When page rendering throws an uncaught error, error boundary renders h1 "Could not verify", lead "This pack could not be displayed, so no verdict was reached. Nothing was uploaded; the file never left this tab.", alert with "Could not verify: <error message>", and button "Load another pack" which calls reset(). Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

The phase 4 user corrections override older wording for the evidence seal time, sample-fail headline, boundary console exception, pinned policy suffix, and non-pack error. See checks.json for exact expected/observed assertions.

4/4 exact checks passed. locator.innerText: Error: strict mode violation: locator('[role=alert]') resolved to 2 elements:
    1) <p role="alert" class="vf-alert">Could not verify: Audit render fault</p> aka getByText('Could not verify: Audit')
    2) <div role="alert" aria-live="assertive" id="__next-route-announcer__"></div> aka locator('[id="__next-route-announcer__"]')

Call log:
[2m  - waiting for locator('[role=alert]')[22m

    at text (/Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:55:46)
    at /Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:111:228
    at async row (/Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:60:3)
    at async file:///Volumes/Extreme%20SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:108:2

Allowed React console.error (captured without suppression):

```text
Error: Audit render fault
    at String.padStart (eval at evaluate (:311:30), <anonymous>:1:196)
    at http://127.0.0.1:54806/_next/static/chunks/app/verify/page-7fba7cbc628c9f1a.js:1:12523
    at Array.map (<anonymous>)
    at x (http://127.0.0.1:54806/_next/static/chunks/app/verify/page-7fba7cbc628c9f1a.js:1:12350)
    at l9 (http://127.0.0.1:54806/_next/static/chunks/d6e00b03-13849fdf938b9eba.js:1:51124)
    at o_ (http://127.0.0.1:54806/_next/static/chunks/d6e00b03-13849fdf938b9eba.js:1:70984)
    at oq (http://127.0.0.1:54806/_next/static/chunks/d6e00b03-13849fdf938b9eba.js:1:82014)
    at ik (http://127.0.0.1:54806/_next/static/chunks/d6e00b03-13849fdf938b9eba.js:1:114676)
    at http://127.0.0.1:54806/_next/static/chunks/d6e00b03-13849fdf938b9eba.js:1:114521
    at ib (http://127.0.0.1:54806/_next/static/chunks/d6e00b03-13849fdf938b9eba.js:1:114529)
```

Evidence: [checks](checks.json), [console](console.json), [network](network.json), [rendered text](screenshot.txt), [screenshot](screenshot.png), [trace](trace.zip).
