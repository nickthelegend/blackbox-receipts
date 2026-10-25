# Phase 4 evidence

Final results: [report](../results-web-phase4.md), [machine results](results.json).

Each ID directory contains final checks.json, console.json, network.json, evidence.md, screenshot.png, screenshot.txt, and trace.zip. API JSON responses and intermediate screenshots are alongside these.

The initial-harness-attempt/ and css-harness-attempt/ subdirectories preserve superseded audit-runner attempts. Their FAIL labels describe harness assertions; the final files directly in each ID directory are authoritative. No product code changed.

Shared logs: install.log and build.log show preparation; lifecycle.log records every owned server/Chrome PID, throwaway store, shutdown, and slot release. run.mjs is the focused reusable harness. run.log records the first corrected run; recorder-rerun.log records the final recorder-only re-check. initial-harness-run.log and initial-harness-results.json preserve the original harness attempt.
