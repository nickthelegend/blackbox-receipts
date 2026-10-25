# WEB-FLOW-RECORDER-TAMPER-CYCLE: FAIL

Real Google Chrome 155.0.8059.85 via Playwright; 2026-10-25T21:52:14.179Z.

AUDIT.md expected cell as present in this worktree:

Selecting block 2 and clicking "Tamper" displays notice "Block 2 edited on disk. Verification now rejects its signature.", sets Chain lamp to "Broken · 02", Tamper lamp to "Edited · 02", No-secrets proof lamp to "Stale", status to "Tamper detected", block 2 pill to "Signature fails", block 3 pill to "Untrusted", and Readouts Rejected to "01"; clicking "Re-verify" executes GET /api/session and keeps broken state; clicking "Restore" displays notice "Restored block(s) 2 to their signed originals.", restores Chain lamp to "Verified", Tamper lamp to "Off", and disables Restore button. Zero console errors, page errors, or unexpected failed same-origin 4xx/5xx requests.

The phase 4 user corrections override older wording for the evidence seal time, sample-fail headline, boundary console exception, pinned policy suffix, and non-pack error. See checks.json for exact expected/observed assertions.

16/21 exact checks passed. Chain: "BROKEN · 02" != "Broken · 02"
Tamper test: "EDITED · 02" != "Edited · 02"
No-secrets proof: "STALE" != "Stale"
restored chain: "VERIFIED" != "Verified"
restored tamper: "OFF" != "Off"

Evidence: [checks](checks.json), [console](console.json), [network](network.json), [rendered text](screenshot.txt), [screenshot](screenshot.png), [trace](trace.zip).
