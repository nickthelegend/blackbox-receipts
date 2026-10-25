# Phase 4 web re-check

8 PASS, 0 FAIL across 8 requested IDs. Real Google Chrome 155.0.8059.85; production Next server built from worktree HEAD 3421305. Final runs captured 2026-10-25 21:52 UTC. No full pnpm test:e2e run.

| ID | Result | Evidence |
| --- | --- | --- |
| WEB-PAGE-EVIDENCE | PASS | [evidence](web-phase4/WEB-PAGE-EVIDENCE/evidence.md) |
| WEB-PAGE-VERIFY-SAMPLE-FAIL | PASS | [evidence](web-phase4/WEB-PAGE-VERIFY-SAMPLE-FAIL/evidence.md) |
| WEB-PAGE-VERIFY-ERROR | PASS | [evidence](web-phase4/WEB-PAGE-VERIFY-ERROR/evidence.md) |
| WEB-FLOW-VERIFY-PINNED-POLICY | PASS | [evidence](web-phase4/WEB-FLOW-VERIFY-PINNED-POLICY/evidence.md) |
| EDGE-VERIFY-NON-PACK | PASS | [evidence](web-phase4/EDGE-VERIFY-NON-PACK/evidence.md) |
| API-POST-PROVE-FAIL | PASS | [evidence](web-phase4/API-POST-PROVE-FAIL/evidence.md) |
| API-GET-EXPLAIN-SUCCESS | PASS | [evidence](web-phase4/API-GET-EXPLAIN-SUCCESS/evidence.md) |
| WEB-FLOW-RECORDER-TAMPER-CYCLE | PASS | [evidence](web-phase4/WEB-FLOW-RECORDER-TAMPER-CYCLE/evidence.md) |

Expectations: Phase 4 user corrections are authoritative for the five corrected page rows; this worktree's AUDIT.md still contains older text for those rows and was left unchanged. API expectations were read verbatim from AUDIT.md. The API prove row additionally verifies the changed success proof aliases, native signature proof, and commitment openings before recording the denied call.

Boundary injection: a deliberate String.padStart render fault reaches the actual React error boundary. Its one React console.error is quoted in full in that row's evidence; no console output was suppressed. Any additional console error, page error or HTTP failure fails a row.

Isolation: fresh real proxy receipts and ephemeral signing material in a unique /private/tmp directory; only public fixture files read. The denied secrets/ path does not exist and is refused before filesystem access. No .env, pre-existing keys, seeds or wallets read. Server environment excludes external credentials; no Zetaris, Meterless or Walrus publisher call. Their recorder lamps show Setup required.

Verification: pnpm install --frozen-lockfile and pnpm build passed; [build log](web-phase4/build.log). No product changes were necessary. No commit or push. AUDIT.md, packages/ sources, receipts/, release/, and audit/web/ were left unchanged.

Cleanup: Chrome and Next processes stopped, temporary receipt/key directory removed, heavy slot bb-audit-web released. [Lifecycle log](web-phase4/lifecycle.log).

Observed exact corrections: seal time `2026-10-21 04:26:20 UTC`; sample-fail headline `FAIL no-secrets-read/v1 at step 3: No proof: step 3 (read_file .env) is signed as a secret access`; policy mismatch ends `not the pinned policy (d1e72d1a6c22)`; non-pack alert contains `Not a Blackbox pack (expected "format": "blackbox-pack/v1")` with no verdict. Recorder Rejected stays `01` after re-verification, and every downstream receipt (steps 3–5) stays `Untrusted` until restore.

Final evidence has 231 exact assertions, zero failed assertions, zero page errors, zero failed requests, and zero HTTP error statuses. The boundary row has exactly one allowed React error; every other final row has zero console output. Screenshots for evidence, sample failure, boundary, policy mismatch, malformed input, and tampered recorder were visually inspected.

Harness corrections: archived `initial-harness-attempt/` files preserve the initial audit-runner errors (CSS casing, an ambiguous alert selector, and treating Fetch Response.url as a method). The recorder's `css-harness-attempt/` preserves a remaining CSS casing comparison. Those attempts did not establish a product failure. Final row files are directly under each ID, with final statuses in `web-phase4/results.json`; the recorder alone was re-run after the last harness correction. DOM source text is compared exactly; screenshots preserve CSS rendering. No verifier message or seal was modified.

Nothing remains undone for these eight IDs. External services remain UNTESTED; only their visible Setup required state was checked here.
