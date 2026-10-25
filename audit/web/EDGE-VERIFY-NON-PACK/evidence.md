# EDGE-VERIFY-NON-PACK: FAIL

Captured 2026-10-25T21:43:04.641Z using real Google Chrome 155.0.8059.85 through Playwright.

Expected (verbatim AUDIT.md cell):

Loading a non-pack JSON file (such as `{"hello":"world"}`) into `/verify` renders alert `<div className="vf-alert" role="alert"><strong>Could not verify.</strong> <filename>: expected a blackbox-pack/v1 object, got ...</div>`, hides result section, and triggers zero unhandled page errors. Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

Observed URL: http://127.0.0.1:3327/verify

Viewport: {"width":1280,"height":800}.

3/4 assertions passed.

- .vf-alert includes not-a-pack.json: expected a blackbox-pack/v1 object, got: got false; expected true

Artifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.

Disposition: packages/verify/src/pack.ts:83 returns "Not a Blackbox pack (expected "format": "blackbox-pack/v1")", rather than "expected a blackbox-pack/v1 object, got ...". Rejection, result clearing, and absence of crashes pass. Package edits are prohibited.
