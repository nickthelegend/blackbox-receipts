# WEB-FLOW-LANDING-PLAYBACK: PASS

Captured 2026-10-25T21:42:35.217Z using real Google Chrome 155.0.8059.85 through Playwright.

Expected (verbatim AUDIT.md cell):

Playback container `.pb` initializes with `data-play="ready"`, transitions to `data-play="run"` upon scrolling into view at 45% threshold, 10 `.tape-mark` elements sweep across, flag displays "Denied · .env", final mark reaches opacity 1, and clicking "Replay" resets to "ready" then "run". Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

Observed URL: http://127.0.0.1:3327/evidence

Viewport: {"width":1280,"height":800}.

6/6 assertions passed.

All asserted text, status and behavior matched. No console output, page errors or failed network requests.

Artifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.

Intermediate screenshots: [sweep-complete](sweep-complete.png).
