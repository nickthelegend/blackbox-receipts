# Public-page browser audit

PASS: 31; FAIL: 5. All 36 rows were exercised in real headless Google Chrome 155.0.8059.85 through Playwright. Each evidence page quotes its AUDIT.md expected cell verbatim and links screenshots, assertions, rendered text, console output, and request/response logs.

`pnpm build` and `pnpm build:pages -- --base-path /blackbox-receipts` both exited 0. The local production Next app ran at `http://127.0.0.1:3327`; the static export ran at `http://127.0.0.1:3329/blackbox-receipts/`; the deck ran at `http://127.0.0.1:3329/docs/deck/index.html`. Desktop viewport: 1280×800. Mobile viewport: 375×812. All four live URLs were opened in Chrome and returned HTTP 200. Offline verification was exercised with the browser network disabled. Signer-key checks used a pack made by a real proxy call in a throwaway `/private/tmp` directory; no service responses were mocked.

All console messages, page errors, request failures, and unexpected HTTP errors were captured without suppression. The error-boundary case deliberately throws a render error: its fallback and reset pass, but React's console error makes that row FAIL under the stated rule. Exact text differences also remain FAIL, with the source and scope constraint in the fix column. Application files, signed receipt data, and AUDIT.md were preserved; the full E2E suite was not run.

The heavy slot was acquired before builds, servers, or Chrome. All nine recorded runner/server/Chrome PIDs exited; ports 3327 and 3329 have no listener. The supervisor released `bb-audit-web`; `/tmp/grokbot-heavy-slots/slot1` was absent when checked. See [run manifest](web/public-page-run.json), [capture runner](web/public-page-audit.mjs), and [build logs](web/WEB-STATIC-BUILD/evidence.md).

| ID | status | evidence | fix |
| --- | --- | --- | --- |
| WEB-PAGE-LANDING | PASS | [Captured evidence](web/WEB-PAGE-LANDING/evidence.md) | — |
| WEB-PAGE-EVIDENCE | FAIL | [Captured evidence](web/WEB-PAGE-EVIDENCE/evidence.md) | Signed seal data is 2026-10-21 04:26:20 UTC; the expected cell requires 04:34:03 UTC. apps/web/app/flight.ts reads receipts/agent-demo/933f87da-c941-4588-8716-d6c8df98aded/seal.json faithfully. Changing signed receipts or AUDIT.md is prohibited. |
| WEB-PAGE-VERIFY-EMPTY | PASS | [Captured evidence](web/WEB-PAGE-VERIFY-EMPTY/evidence.md) | — |
| WEB-PAGE-VERIFY-SAMPLE-PASS | PASS | [Captured evidence](web/WEB-PAGE-VERIFY-SAMPLE-PASS/evidence.md) | — |
| WEB-PAGE-VERIFY-SAMPLE-FAIL | FAIL | [Captured evidence](web/WEB-PAGE-VERIFY-SAMPLE-FAIL/evidence.md) | packages/verify/src/pack.ts returns "FAIL no-secrets-read/v1 at step 3: No proof: step 3 (read_file .env) is signed as a secret access", rather than the expected headline. Package edits are prohibited; the UI displays the verifier result faithfully. |
| WEB-PAGE-VERIFY-ERROR | FAIL | [Captured evidence](web/WEB-PAGE-VERIFY-ERROR/evidence.md) | Boundary text, alert, and reset all pass. Deliberately throwing during the real receipt render reaches apps/web/app/verify/error.tsx, but React/Next emits console.error("Audit render fault"). The strict console rule makes the row FAIL. Error reporting was captured without suppression. |
| WEB-SCREEN-DECK | PASS | [Captured evidence](web/WEB-SCREEN-DECK/evidence.md) | — |
| WEB-NAV-LANDING | PASS | [Captured evidence](web/WEB-NAV-LANDING/evidence.md) | — |
| WEB-NAV-EVIDENCE | PASS | [Captured evidence](web/WEB-NAV-EVIDENCE/evidence.md) | — |
| WEB-NAV-VERIFY | PASS | [Captured evidence](web/WEB-NAV-VERIFY/evidence.md) | — |
| WEB-STATIC-BUILD | PASS | [Captured evidence](web/WEB-STATIC-BUILD/evidence.md) | — |
| WEB-STATIC-RECORDER-LINK | PASS | [Captured evidence](web/WEB-STATIC-RECORDER-LINK/evidence.md) | — |
| WEB-STATIC-LANDING-LINK | PASS | [Captured evidence](web/WEB-STATIC-LANDING-LINK/evidence.md) | — |
| WEB-STATIC-VERIFY-OFFLINE | PASS | [Captured evidence](web/WEB-STATIC-VERIFY-OFFLINE/evidence.md) | — |
| WEB-LIVE-VERCEL-LANDING | PASS | [Captured evidence](web/WEB-LIVE-VERCEL-LANDING/evidence.md) | — |
| WEB-LIVE-VERCEL-EVIDENCE | PASS | [Captured evidence](web/WEB-LIVE-VERCEL-EVIDENCE/evidence.md) | — |
| WEB-LIVE-VERCEL-VERIFY | PASS | [Captured evidence](web/WEB-LIVE-VERCEL-VERIFY/evidence.md) | — |
| WEB-LIVE-GHPAGES | PASS | [Captured evidence](web/WEB-LIVE-GHPAGES/evidence.md) | — |
| WEB-FLOW-LANDING-PLAYBACK | PASS | [Captured evidence](web/WEB-FLOW-LANDING-PLAYBACK/evidence.md) | — |
| WEB-FLOW-PLAYBACK-COPY | PASS | [Captured evidence](web/WEB-FLOW-PLAYBACK-COPY/evidence.md) | — |
| WEB-FLOW-TAPE-LOG-DRAWER | PASS | [Captured evidence](web/WEB-FLOW-TAPE-LOG-DRAWER/evidence.md) | — |
| WEB-FLOW-INVESTIGATION-EXHIBITS | PASS | [Captured evidence](web/WEB-FLOW-INVESTIGATION-EXHIBITS/evidence.md) | — |
| WEB-FLOW-VERIFY-FILE-PICKER | PASS | [Captured evidence](web/WEB-FLOW-VERIFY-FILE-PICKER/evidence.md) | — |
| WEB-FLOW-VERIFY-DRAG-DROP | PASS | [Captured evidence](web/WEB-FLOW-VERIFY-DRAG-DROP/evidence.md) | — |
| WEB-FLOW-VERIFY-PINNED-POLICY | FAIL | [Captured evidence](web/WEB-FLOW-VERIFY-PINNED-POLICY/evidence.md) | packages/verify/src/core.ts:260 adds " (d1e72d1a6c22)" after "not the pinned policy". Exact headline differs from the expected cell; the policy and tamper behavior pass. Package edits are prohibited. |
| WEB-FLOW-VERIFY-KEY-PINNING | PASS | [Captured evidence](web/WEB-FLOW-VERIFY-KEY-PINNING/evidence.md) | — |
| WEB-FLOW-REDUCED-MOTION | PASS | [Captured evidence](web/WEB-FLOW-REDUCED-MOTION/evidence.md) | — |
| EDGE-VERIFY-NON-PACK | FAIL | [Captured evidence](web/EDGE-VERIFY-NON-PACK/evidence.md) | packages/verify/src/pack.ts:83 returns "Not a Blackbox pack (expected "format": "blackbox-pack/v1")", rather than "expected a blackbox-pack/v1 object, got ...". Rejection, result clearing, and absence of crashes pass. Package edits are prohibited. |
| EDGE-VERIFY-NULL-RECEIPT | PASS | [Captured evidence](web/EDGE-VERIFY-NULL-RECEIPT/evidence.md) | — |
| EDGE-VERIFY-OBJECT-OUTCOME | PASS | [Captured evidence](web/EDGE-VERIFY-OBJECT-OUTCOME/evidence.md) | — |
| EDGE-VERIFY-OBJECT-STEP | PASS | [Captured evidence](web/EDGE-VERIFY-OBJECT-STEP/evidence.md) | — |
| EDGE-VERIFY-OVERSIZE-FILE | PASS | [Captured evidence](web/EDGE-VERIFY-OVERSIZE-FILE/evidence.md) | — |
| EDGE-WIDTH-375-LANDING | PASS | [Captured evidence](web/EDGE-WIDTH-375-LANDING/evidence.md) | — |
| EDGE-WIDTH-375-EVIDENCE | PASS | [Captured evidence](web/EDGE-WIDTH-375-EVIDENCE/evidence.md) | — |
| EDGE-WIDTH-375-VERIFY | PASS | [Captured evidence](web/EDGE-WIDTH-375-VERIFY/evidence.md) | — |
| EDGE-WIDTH-375-DECK | PASS | [Captured evidence](web/EDGE-WIDTH-375-DECK/evidence.md) | — |
