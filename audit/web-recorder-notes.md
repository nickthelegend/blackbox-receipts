# Recorder audit run notes

The final browser run completed all 16 requested rows: **14 PASS, 2 FAIL, 0 UNTESTED**. The three Setup required lamps passed by browser observation, including their exact labels, state, caution class, and detail strings. No Zetaris, Meterless, or Walrus publisher request was made.

Two application defects were observed, fixed, rebuilt, and rerun:

- `WEB-PAGE-RECORDER`: Readouts was a section with spans instead of the required description list. `apps/web/app/recorder/page.tsx` now uses a `dl` with `dt`/`dd` pairs, including a valid grouped public-key entry. Recorder CSS preserves spacing and responsive layout.
- `WEB-FLOW-RECORDER-TAMPER-CYCLE`: Rejected incorrectly included every downstream receipt after a break. The readout now counts the first rejected signature as `01`; downstream blocks retain their Untrusted status. The entire tamper, re-verify, and restore cycle passed.

The two final FAIL rows are strict console-rule failures; their functional checks passed:

- `EDGE-RECORDER-TORN-LOG`: the API correctly returned 409 with `corruptLine: 2` and the exact error reflected by the alert, and the page showed Session unavailable without overflow. Chrome emitted `Failed to load resource: the server responded with a status of 409 (Conflict)`.
- `EDGE-RECORDER-CROSS-SITE-POST`: four real browser POSTs from two foreign origins were refused with 403; after each request `tampered` remained `[2]`. Chrome emitted a resource console error for each refusal.

The console messages originate in `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. The required HTTP statuses originate in `apps/web/app/api/corrupt.ts` and `apps/web/middleware.ts`. Changing those statuses to hide Chrome's messages would violate these rows' required API behavior. No such change was made. The global instruction “A console error ... is FAIL” was applied to the final results, even for these expected error responses.

Evidence includes a screenshot, page text, console log, network log, and Playwright trace for every row. Original attempts for the two fixed rows and the two error-response rows are preserved in their `initial-attempt` folders. The first run treated the expected resource errors as exceptions, as the existing E2E fixture does; the final run removed that allowance to follow the user's stricter global instruction.

Verification: full `pnpm build`, production web rebuild after fixes, all 16 recorder rows rerun in Playwright Google Chrome, targeted ESLint, and `git diff --check`. Mobile document and drawer widths were both 375px in the final run. No `pnpm test:e2e` invocation. No edits to AUDIT.md, packages, test, scripts, receipts, or release source files.

The runner used supported `RECEIPTS_SESSION_ID` configuration for the required `933f87da` prefix, real proxy calls matching `e2e/serve-dashboard.ts`, and fresh receipt/key directories under the OS temporary directory. It used an allowlisted process environment with all five required sponsor/publisher variables absent. No user environment or key files were read. Generated temporary stores were removed after evidence capture.

Chrome was closed, both owned dashboard PIDs exited, the cross-origin source server closed, and the `bb-audit-web` heavy slot was released. See `web-recorder-cleanup.json`.

Evidence was saved after every row, including checkpoints at rows 8 and 16. No commits were made: the authoritative Loom handoff explicitly says not to commit and delegates commits/merges to Loom. This takes precedence over the conflicting per-fix/eight-row commit requests.
