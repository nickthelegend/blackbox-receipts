# API-POST-PROVE-FAIL: FAIL

Real Google Chrome 155.0.8059.85 via Playwright; 2026-10-25T21:51:37.483Z.

AUDIT.md expected cell as present in this worktree:

Returns HTTP 200 with JSON `{ status: "FAIL", step: number, reason: string, policyId: "no-secrets-read/v2", sessionRoot: string, chainBrokenAt: number or null }` naming the step where secret path was touched (e.g. step 4) and matching policy glob.

The phase 4 user corrections override older wording for the evidence seal time, sample-fail headline, boundary console exception, pinned policy suffix, and non-pack error. See checks.json for exact expected/observed assertions.

1/1 exact checks passed. page.evaluate: TypeError: r.url is not a function
    at eval (eval at evaluate (:311:30), <anonymous>:1:105)
    at async <anonymous>:337:30
    at request (/Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:57:62)
    at /Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:129:17
    at row (/Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:60:9)
    at async file:///Volumes/Extreme%20SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:127:2

Evidence: [checks](checks.json), [console](console.json), [network](network.json), [rendered text](screenshot.txt), [screenshot](screenshot.png), [trace](trace.zip).
