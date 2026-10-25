# API-GET-EXPLAIN-SUCCESS: FAIL

Real Google Chrome 155.0.8059.85 via Playwright; 2026-10-25T21:51:38.661Z.

AUDIT.md expected cell as present in this worktree:

Returns HTTP 200 with JSON `{ sessionId: string, verdict: string, policyId: string, steps: Array<{ step: number, receipt: string, timestamp: string, command: string, outcome: string, finding: "allowed" or "tool-error" or "violation" or "untrusted" or "unchecked", detail: string or null, why: string[], cites: Array<{ step: number, role: string, hash: string, note: string }> }> }`.

The phase 4 user corrections override older wording for the evidence seal time, sample-fail headline, boundary console exception, pinned policy suffix, and non-pack error. See checks.json for exact expected/observed assertions.

1/1 exact checks passed. page.evaluate: TypeError: r.url is not a function
    at eval (eval at evaluate (:311:30), <anonymous>:1:105)
    at async <anonymous>:337:30
    at request (/Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:57:62)
    at /Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:139:17
    at row (/Volumes/Extreme SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:60:9)
    at async file:///Volumes/Extreme%20SSD/Projects/.loom-worktrees/blackbox-receipts-e8f771dc6991/omvoa7g8u/t-phase4/audit/web-phase4/run.mjs:138:2

Evidence: [checks](checks.json), [console](console.json), [network](network.json), [rendered text](screenshot.txt), [screenshot](screenshot.png), [trace](trace.zip).
