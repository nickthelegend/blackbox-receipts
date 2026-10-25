# EDGE-VERIFY-OVERSIZE-FILE: PASS

Captured 2026-10-25T21:43:10.189Z using real Google Chrome 155.0.8059.85 through Playwright.

Expected (verbatim AUDIT.md cell):

Selecting a file larger than 20,000,000 bytes in `/verify` sets error alert `<file.name>: larger than 20 MB, which is not a pack this page will read`, clears loaded pack state, and triggers zero unhandled page errors. Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

Observed URL: http://127.0.0.1:3327/verify

Viewport: {"width":1280,"height":800}.

3/3 assertions passed.

All asserted text, status and behavior matched. No console output, page errors or failed network requests.

Artifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.
