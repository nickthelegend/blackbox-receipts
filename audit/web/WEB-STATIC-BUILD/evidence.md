# WEB-STATIC-BUILD: PASS

Captured 2026-10-25T21:42:23.845Z using real Google Chrome 155.0.8059.85 through Playwright.

Expected (verbatim AUDIT.md cell):

Command `node scripts/build-pages.mjs --out public --base-path /blackbox-receipts` succeeds with exit 0, outputs `public/index.html`, `public/evidence/index.html`, `public/verify/index.html`, and `public/.nojekyll`, excluding api/ and recorder/ directories.

Observed URL: http://127.0.0.1:3329/blackbox-receipts/

Viewport: {"width":1280,"height":800}.

9/9 assertions passed.

All asserted text, status and behavior matched. No console output, page errors or failed network requests.

Artifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.

Build evidence: [pnpm build](build.log), [pnpm build:pages -- --base-path /blackbox-receipts](pages-build.log). Both commands exited 0; the shell reached its build-ready marker only after both succeeded.
