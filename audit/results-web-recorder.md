# Recorder browser audit

2026-10-25T21:23:21.257Z — Chrome, production Next server; desktop 1280×800, mobile 375×812. Real proxy calls and isolated OS-temp receipt/key directories. ZETARIS_API_KEY, ZETARIS_ORG_ID, METERLESS_TOKEN, METERLESS_STATE_DIR, WALRUS_PUBLISHER_URL unset for both servers and proxy. No sponsor/publisher requests.

PASS: 16; FAIL: 0; UNTESTED: 0.

Evidence saved per row and after each group of eight. Commits are left to Loom per the session's no-commit instruction. The required corruption 409 and CSRF 403 responses are correct. A Chrome line "Failed to load resource: the server responded with a status of NNN" does not fail a row when the row requires HTTP NNN, so both edge rows PASS. Their functional assertions passed. See [run notes](web-recorder-notes.md).

| ID | status | evidence | fix |
| --- | --- | --- | --- |
| WEB-PAGE-RECORDER | PASS | [Evidence](web/WEB-PAGE-RECORDER/evidence.json), [screenshot](web/WEB-PAGE-RECORDER/final.png), console.json, network.json | Readouts use a semantic dl with dt/dd. |
| WEB-NAV-RECORDER | PASS | [Evidence](web/WEB-NAV-RECORDER/evidence.json), [screenshot](web/WEB-NAV-RECORDER/final.png), console.json, network.json | — |
| WEB-LAMP-ZETARIS-SETUP | PASS | [Evidence](web/WEB-LAMP-ZETARIS-SETUP/evidence.json), [screenshot](web/WEB-LAMP-ZETARIS-SETUP/final.png), console.json, network.json | — |
| WEB-LAMP-METERLESS-SETUP | PASS | [Evidence](web/WEB-LAMP-METERLESS-SETUP/evidence.json), [screenshot](web/WEB-LAMP-METERLESS-SETUP/final.png), console.json, network.json | — |
| WEB-LAMP-WALRUS-SETUP | PASS | [Evidence](web/WEB-LAMP-WALRUS-SETUP/evidence.json), [screenshot](web/WEB-LAMP-WALRUS-SETUP/final.png), console.json, network.json | — |
| WEB-LAMP-CHAIN-SECRET | PASS | [Evidence](web/WEB-LAMP-CHAIN-SECRET/evidence.json), [screenshot](web/WEB-LAMP-CHAIN-SECRET/final.png), console.json, network.json | — |
| WEB-FLOW-RECORDER-STORE-LABEL | PASS | [Evidence](web/WEB-FLOW-RECORDER-STORE-LABEL/evidence.json), [screenshot](web/WEB-FLOW-RECORDER-STORE-LABEL/final.png), console.json, network.json | — |
| WEB-FLOW-RECORDER-KEY-TOGGLE | PASS | [Evidence](web/WEB-FLOW-RECORDER-KEY-TOGGLE/evidence.json), [screenshot](web/WEB-FLOW-RECORDER-KEY-TOGGLE/final.png), console.json, network.json | — |
| WEB-FLOW-RECORDER-LOG-EXPLAIN | PASS | [Evidence](web/WEB-FLOW-RECORDER-LOG-EXPLAIN/evidence.json), [screenshot](web/WEB-FLOW-RECORDER-LOG-EXPLAIN/final.png), console.json, network.json | — |
| WEB-FLOW-RECORDER-PROVE | PASS | [Evidence](web/WEB-FLOW-RECORDER-PROVE/evidence.json), [screenshot](web/WEB-FLOW-RECORDER-PROVE/final.png), console.json, network.json | — |
| WEB-FLOW-RECORDER-TAMPER-CYCLE | PASS | [Evidence](web/WEB-FLOW-RECORDER-TAMPER-CYCLE/evidence.json), [screenshot](web/WEB-FLOW-RECORDER-TAMPER-CYCLE/final.png), console.json, network.json | Rejected counts the rejected signature; downstream receipts remain Untrusted. |
| WEB-FLOW-RECORDER-NEW-CALL | PASS | [Evidence](web/WEB-FLOW-RECORDER-NEW-CALL/evidence.json), [screenshot](web/WEB-FLOW-RECORDER-NEW-CALL/final.png), console.json, network.json | — |
| EDGE-RECORDER-EMPTY-STORE | PASS | [Evidence](web/EDGE-RECORDER-EMPTY-STORE/evidence.json), [screenshot](web/EDGE-RECORDER-EMPTY-STORE/final.png), console.json, network.json | — |
| EDGE-RECORDER-TORN-LOG | PASS | [Evidence](web/EDGE-RECORDER-TORN-LOG/evidence.json), [screenshot](web/EDGE-RECORDER-TORN-LOG/final.png), console.json, network.json; functional 409 matched; Chrome resource line for the required 409 is not a product failure. | — |
| EDGE-RECORDER-CROSS-SITE-POST | PASS | [Evidence](web/EDGE-RECORDER-CROSS-SITE-POST/evidence.json), [screenshot](web/EDGE-RECORDER-CROSS-SITE-POST/final.png), console.json, network.json; functional 403 matched; Chrome resource line for the required 403 is not a product failure. | — |
| EDGE-WIDTH-375-RECORDER | PASS | [Evidence](web/EDGE-WIDTH-375-RECORDER/evidence.json), [screenshot](web/EDGE-WIDTH-375-RECORDER/final.png), console.json, network.json | — |
