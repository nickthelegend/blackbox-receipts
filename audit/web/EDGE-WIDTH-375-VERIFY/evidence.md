# EDGE-WIDTH-375-VERIFY: PASS

Captured 2026-10-25T21:43:16.372Z using real Google Chrome 155.0.8059.85 through Playwright.

Expected (verbatim AUDIT.md cell):

At viewport width 375px and height 812px, document scrollWidth does not exceed clientWidth; drop zone, sample buttons, pinned policy select, expected signer key textarea, checks list, and step cards fit without horizontal scrolling across empty, loaded, and error states. Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

Observed URL: http://127.0.0.1:3327/verify

Viewport: {"width":375,"height":812}.

5/5 assertions passed.

All asserted text, status and behavior matched. No console output, page errors or failed network requests.

Artifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.

Intermediate screenshots: [empty](empty.png), [error](error.png), [loaded-with-custom-key](loaded-with-custom-key.png).
