# WEB-FLOW-VERIFY-KEY-PINNING: PASS

Captured 2026-10-25T21:43:01.119Z using real Google Chrome 155.0.8059.85 through Playwright.

Expected (verbatim AUDIT.md cell):

Loading a pack with a fresh key while Expected signer key is "none" displays amber badge "PASS (key not pinned)" with class vf-badge-warn and SHA-256 fingerprint; selecting "demo" key displays red badge "FAIL" with headline "FAIL: Pack public key does not match the pinned key"; selecting "custom" and pasting matching PEM displays green badge "PASS" with class vf-badge-ok; pasting non-key text displays "FAIL"; loading a sample re-pins demo key to green PASS; loading another user pack afterwards resets key pin to none. Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

Observed URL: http://127.0.0.1:3327/verify

Viewport: {"width":1280,"height":800}.

14/14 assertions passed.

All asserted text, status and behavior matched. No console output, page errors or failed network requests.

Artifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.

Intermediate screenshots: [amber](amber.png), [green](green.png), [red](red.png).
