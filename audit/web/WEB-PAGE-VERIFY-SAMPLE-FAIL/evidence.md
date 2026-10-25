# WEB-PAGE-VERIFY-SAMPLE-FAIL: FAIL

Captured 2026-10-25T21:42:03.995Z using real Google Chrome 155.0.8059.85 through Playwright.

Expected (verbatim AUDIT.md cell):

Clicking "Agent tried to read .env" loads pack, badge displays "FAIL", headline displays 'FAIL no-secrets-read at step 3: read_file touched secret path matching ".env*"', 10 steps rendered with step 03 marked Secret access (outcome denied), 0 network requests after load. Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

Observed URL: http://127.0.0.1:3327/verify

Viewport: {"width":1280,"height":800}.

7/8 assertions passed.

- headline: got "FAIL no-secrets-read/v1 at step 3: No proof: step 3 (read_file .env) is signed as a secret access"; expected "FAIL no-secrets-read at step 3: read_file touched secret path matching \".env*\""

Artifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.

Disposition: packages/verify/src/pack.ts returns "FAIL no-secrets-read/v1 at step 3: No proof: step 3 (read_file .env) is signed as a secret access", rather than the expected headline. Package edits are prohibited; the UI displays the verifier result faithfully.
