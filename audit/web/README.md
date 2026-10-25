Final row evidence is API-*/network.log, console.log, and screenshot.png. results.json contains the 25 executed rows. The two dependency-gated rows were not called; see ../results-web-api.md.

Initial captures are retained for traceability. Their statuses are historical, not the final audit score. In particular the initial CDP middleware attempts did not put the required Fetch Metadata headers on the wire and are not evidence of a middleware product defect. initial-results.json records the first run; final results.json supersedes it.

run-web-api.mjs uses a real production dashboard and real Google Chrome. Acquire tools/heavy-slot.sh acquire bb-audit-web before invoking it, including before building. The runner closes its owned browser/server processes, removes throwaway state, and releases the slot in its cleanup path. Optional command arguments restrict the scored rows while preserving other final results. No external response stubs exist.
