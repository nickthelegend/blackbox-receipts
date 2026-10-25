# WEB-PAGE-EVIDENCE: FAIL

Captured 2026-10-25T21:41:59.717Z using real Google Chrome 155.0.8059.85 through Playwright.

Expected (verbatim AUDIT.md cell):

Renders title "The tape, the checks and the limits.", kicker "Evidence · session 933f87da", summary strip with "Agent flight recorder", "Session 933f87da", "10 receipts", "Sealed 2026-10-21 04:34:03 UTC", "Denied at step 03", Fig. 1 parts diagram, sections "01 · Tape playback", "02 · Investigation", "03 · Limitations placard" (7 items including Setup required and Not run yet), and "04 · Built in the window" (8 items, lead case-variant diff). Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

Observed URL: http://127.0.0.1:3327/evidence

Viewport: {"width":1280,"height":800}.

23/24 assertions passed.

- .ld-strip includes Sealed 2026-10-21 04:34:03 UTC: got false; expected true

Artifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.

Disposition: Signed seal data is 2026-10-21 04:26:20 UTC; the expected cell requires 04:34:03 UTC. apps/web/app/flight.ts reads receipts/agent-demo/933f87da-c941-4588-8716-d6c8df98aded/seal.json faithfully. Changing signed receipts or AUDIT.md is prohibited.
