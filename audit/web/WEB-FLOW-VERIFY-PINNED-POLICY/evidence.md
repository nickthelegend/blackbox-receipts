# WEB-FLOW-VERIFY-PINNED-POLICY: FAIL

Captured 2026-10-25T21:42:59.630Z using real Google Chrome 155.0.8059.85 through Playwright.

Expected (verbatim AUDIT.md cell):

Pinned policy selector defaults to no-secrets-read/v2; loading sample `agent-pass.json` automatically sets selector to no-secrets-read/v1 with badge "PASS"; changing selector back to no-secrets-read/v2 updates badge to "FAIL" with headline 'FAIL property: Proof was made under policy "no-secrets-read/v1" (720836167c0f), not the pinned policy'; flipping one byte at step 5 maintains failure across policy re-pins with headline "FAIL at step 5: Receipt contents were changed". Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

Observed URL: http://127.0.0.1:3327/verify

Viewport: {"width":1280,"height":800}.

7/8 assertions passed.

- policy mismatch headline: got "FAIL property: Proof was made under policy \"no-secrets-read/v1\" (720836167c0f), not the pinned policy (d1e72d1a6c22)"; expected "FAIL property: Proof was made under policy \"no-secrets-read/v1\" (720836167c0f), not the pinned policy"

Artifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.

Intermediate screenshots: [v2-rejection](v2-rejection.png).

Disposition: packages/verify/src/core.ts:260 adds " (d1e72d1a6c22)" after "not the pinned policy". Exact headline differs from the expected cell; the policy and tamper behavior pass. Package edits are prohibited.
