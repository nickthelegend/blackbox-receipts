# WEB-FLOW-VERIFY-DRAG-DROP: PASS

Captured 2026-10-25T21:42:58.127Z using real Google Chrome 155.0.8059.85 through Playwright.

Expected (verbatim AUDIT.md cell):

Dragging pack file over label `.vf-drop` adds class `is-drag`; dropping file removes class `is-drag`, loads pack into verifier, and displays verification result badge (e.g. "PASS (key not pinned)" when policy matches) with filename in meta. Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

Observed URL: http://127.0.0.1:3327/verify

Viewport: {"width":1280,"height":800}.

5/5 assertions passed.

All asserted text, status and behavior matched. No console output, page errors or failed network requests.

Artifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.
