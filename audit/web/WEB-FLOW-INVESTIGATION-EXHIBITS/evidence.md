# WEB-FLOW-INVESTIGATION-EXHIBITS: PASS

Captured 2026-10-25T21:42:54.312Z using real Google Chrome 155.0.8059.85 through Playwright.

Expected (verbatim AUDIT.md cell):

Selecting Exhibit A and clicking "Run the checks" shows stamp "Fail", headline naming step 3, 10 cells; selecting step 7 and clicking "Flip one byte and re-check" shows edit notice "inside step 7's resultHash" and cell 07 broken; clicking "Original file" restores clean state; selecting Exhibit B and running checks shows stamp "Pass", 5/5 ok checks, meta text 'policy no-secrets-read/v1, the one in force when this run was recorded'; flipping one byte shows "Fail" and 1 broken cell. Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

Observed URL: http://127.0.0.1:3327/evidence

Viewport: {"width":1280,"height":800}.

13/13 assertions passed.

All asserted text, status and behavior matched. No console output, page errors or failed network requests.

Artifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.

Intermediate screenshots: [exhibit-a-edited](exhibit-a-edited.png), [exhibit-a](exhibit-a.png), [exhibit-b](exhibit-b.png).
