# Testing Blackbox Receipts

`pnpm test` runs `node --test` over `test/*.test.ts` from source. No external API is mocked. Tests that
need a tool server start the real proxy over stdio with the MCP SDK client, and the `--upstream` tests put
it in front of `test/fixtures/upstream-server.mjs`, a small hand-written JSON-RPC MCP server with no SDK.
Tests that need git create real repositories in temp directories. Each test uses throwaway receipt and
key directories (`RECEIPTS_DIR`, `BLACKBOX_KEY_DIR`), so nothing touches `~/.blackbox`.

Counted on 2026-10-21, run file by file:

| File | Tests | Pass | Skipped | What it runs against / checks |
|---|---|---|---|---|
| `receipts.test.ts` | 5 | 5 | 0 | Ed25519 chain: valid, edited receipt named, broken links and reordering, Merkle membership; seal exact/prefix, forged seal, wrong key, missing seal |
| `property.test.ts` | 15 | 15 | 0 | Property proofs: clean PASS without leaking arguments, tampered chain or bundle named, empty session, secret paths (`.env*`, `~/.ssh/**`, `*.pem`) and token patterns, missing or mismatched witness, selective disclosure; the real CLI as a subprocess (prove, verify-proof, tamper); policy pinning (`prove --policy empty.json` FAILs); salted `argsHash`; `explain` markdown |
| `concurrency.test.ts` | 2 | 2 | 0 | 20 parallel `read_file` calls through one proxy give steps 1..20 and a valid chain; 6 bridge processes at once on a fresh directory share one new key and one chain |
| `session-lifecycle.test.ts` | 4 | 4 | 0 | A restart archives the previous session with its witness; shutdown seals; dropping the last receipt of the live log or of an export fails on the seal; missing seal fails; the key lands in `BLACKBOX_KEY_DIR`, never in the store or an export |
| `guard.test.ts` | 1 | 1 | 0 | `*.pem` and `*.key` reads through the proxy are refused before running, recorded as denied, and the guard's rule equals the prover's per step |
| `upstream.test.ts` | 4 | 4 | 0 | Proxy in front of the fixture MCP server: `tools/list` passthrough, results and upstream errors forwarded, a `*.pem` read denied and never reaching the upstream, 20 parallel calls keep one chain with export PASS, a bad upstream command fails loudly, helpers |
| `pack.test.ts` | 3 | 3 | 0 | Packs of a real session verify with `@blackbox/verify`; one changed byte (resultHash, tool or signature) fails at that step with later steps untrusted; truncation, forged commitment, other key, pinned key; CLI `verify-pack`; packing the committed FAIL agent run |
| `attest.test.ts` | 3 | 3 | 0 | Receipt-gated merge on real git repos: writes through `write_file` are green (JUnit, verifying signed attestation, also from an export); a human edit is red at its step; a bypass write and a delete are red as unrecorded |
| `gitlab-bridge.test.ts` | 4 | 4 | 0 | The one-shot `call` bridge as separate processes: one session, export and verify-export PASS; a `.env` read denied and FAIL at that step; edited export and unpinned key fail; nothing exported fails |
| `gitlab-flow.test.ts` | 1 | 1 | 0 | The Duo flow YAML only reaches the workspace through the bridge |
| `zetaris.test.ts` | 4 | 2 | **2** | Config errors and URL handling. The 2 live tests skip: `ZETARIS_API_KEY` / `ZETARIS_ORG_ID` are not set (Setup required) |
| `meterless.test.ts` | 5 | 3 | **2** | Config, token and URL handling. The 2 live tests skip: no `METERLESS_TOKEN` or runtime (Setup required) |
| **Total** | **51** | **47** | **4** | Skipped tests print a `⚠️ SKIPPING LIVE … TESTS` banner, so a green run never implies a sponsor call happened |

## Other checks (all pass at this commit)

| Command | What |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` over every package, the tests and the web app |
| `pnpm lint` | ESLint 10 + typescript-eslint recommended |
| `pnpm build` | All packages and the Next.js app (including `/verify`) |
| `bash scripts/ci/verify-live-session.sh` | Records a real session through the bridge on this checkout: clean PASS, then a `.env.example` read FAILs at step 5, a tampered log FAILs at step 1, an empty session FAILs |
| `bash scripts/ci/verify-agent-demo.sh` | Re-verifies the committed live agent runs in `receipts/agent-demo/` from their exported files: one PASS, one FAIL at step 3 with chain and seal intact |

## Live runs (not part of `pnpm test`)

- `scripts/demo-agent.sh`: a real LLM agent (opencode 1.18.31, OpenRouter `minimax/minimax-m3.1-flash:free`) restricted to the proxy's tools, against `examples/injection-repo`. Two runs are committed under `receipts/agent-demo/` (README "Live agent run").
- `packages/proxy/dist/bench.js`: per-call overhead, 20 sessions × 25 calls, real measurements in `docs/benchmark.json` (about 0.7 ms per call).
- Browser: `/verify` was checked in a real browser against `next start`: both sample packs, a one-byte flip at step 7 (Broken, then Untrusted after it), no network request after page load, and no horizontal overflow at 375 px.
