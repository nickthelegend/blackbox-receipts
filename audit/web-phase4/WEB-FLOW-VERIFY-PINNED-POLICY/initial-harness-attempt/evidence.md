# WEB-FLOW-VERIFY-PINNED-POLICY: PASS

Real Google Chrome 155.0.8059.85 via Playwright; 2026-10-25T21:51:34.867Z.

AUDIT.md expected cell as present in this worktree:

Pinned policy selector defaults to no-secrets-read/v2; loading sample `agent-pass.json` automatically sets selector to no-secrets-read/v1 with badge "PASS"; changing selector back to no-secrets-read/v2 updates badge to "FAIL" with headline 'FAIL property: Proof was made under policy "no-secrets-read/v1" (720836167c0f), not the pinned policy'; flipping one byte at step 5 maintains failure across policy re-pins with headline "FAIL at step 5: Receipt contents were changed". Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

The phase 4 user corrections override older wording for the evidence seal time, sample-fail headline, boundary console exception, pinned policy suffix, and non-pack error. See checks.json for exact expected/observed assertions.

12/12 exact checks passed. No unexpected console errors, page errors, failed requests, or HTTP error statuses.

Evidence: [checks](checks.json), [console](console.json), [network](network.json), [rendered text](screenshot.txt), [screenshot](screenshot.png), [trace](trace.zip).
