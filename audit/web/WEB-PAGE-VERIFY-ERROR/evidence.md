# WEB-PAGE-VERIFY-ERROR: FAIL

Captured 2026-10-25T21:42:05.598Z using real Google Chrome 155.0.8059.85 through Playwright.

Expected (verbatim AUDIT.md cell):

When page rendering throws an uncaught error, error boundary renders h1 "Could not verify", lead "This pack could not be displayed, so no verdict was reached. Nothing was uploaded; the file never left this tab.", alert with "Could not verify: <error message>", and button "Load another pack" which calls reset(). Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

Observed URL: http://127.0.0.1:3327/verify

Viewport: {"width":1280,"height":800}.

5/5 assertions passed.

- error: Error: Audit render fault     at String.padStart (eval at evaluate (:311:30), <anonymous>:1:196)     at http://127.0.0.1:3327/_next/static/chunks/app/verify/page-425545fcc731ceac.js:1:12523     at Array.map (<anonymous>)     at x (http://127.0.0.1:3327/_next/static/chunks/app/verify/page-425545fcc731ceac.js:1:12350)     at l9 (http://127.0.0.1:3327/_next/static/chunks/d6e00b03-13849fdf938b9eba.js:1:51124)     at o_ (http://127.0.0.1:3327/_next/static/chunks/d6e00b03-13849fdf938b9eba.js:1:70984)     at oq (http://127.0.0.1:3327/_next/static/chunks/d6e00b03-13849fdf938b9eba.js:1:82014)     at ik (http://127.0.0.1:3327/_next/static/chunks/d6e00b03-13849fdf938b9eba.js:1:114676)     at http://127.0.0.1:3327/_next/static/chunks/d6e00b03-13849fdf938b9eba.js:1:114521     at ib (http://127.0.0.1:3327/_next/static/chunks/d6e00b03-13849fdf938b9eba.js:1:114529)

Artifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.

Intermediate screenshots: [error-boundary](error-boundary.png).

Disposition: Boundary text, alert, and reset all pass. Deliberately throwing during the real receipt render reaches apps/web/app/verify/error.tsx, but React/Next emits console.error("Audit render fault"). The strict console rule makes the row FAIL. Error reporting was captured without suppression.
