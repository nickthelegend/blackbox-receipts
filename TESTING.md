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
| `attest.test.ts` | 6 | 6 | 0 | Receipt-gated merge on real git repos: writes through `write_file` are green (JUnit, verifying signed attestation, also from an export); a human edit is red at its step; a bypass write and a delete are red as unrecorded. `scripts/ci/attest-diff-pr.sh` (the CI entry point) on real commits: green on an agent export, red after a human commit with the JUnit summary naming the file, not applicable without an export, FAIL with two exports or a missing base. The committed `receipts/attest-diff-demo/` output re-checked: attestation signatures, exported chains and seals, verdicts and failing files |
| `explain.test.ts` | 2 | 2 | 0 | The proxy's `blackbox_explain` MCP tool on a real session (listed after the built-in tools, one step with its cited receipts, the whole session, an unknown step as an error, each call recorded with a valid chain); `explain --json` findings and citations per step, its markdown equal to `explain`, `--step`; both committed agent runs' `explain.json` render to their `explain.md` and cite their exported receipts |
| `gitlab-bridge.test.ts` | 4 | 4 | 0 | The one-shot `call` bridge as separate processes: one session, export and verify-export PASS; a `.env` read denied and FAIL at that step; edited export and unpinned key fail; nothing exported fails |
| `gitlab-flow.test.ts` | 1 | 1 | 0 | The Duo flow YAML only reaches the workspace through the bridge |
| `zetaris.test.ts` | 4 | 2 | **2** | Config errors and URL handling. The 2 live tests skip: `ZETARIS_API_KEY` / `ZETARIS_ORG_ID` are not set (Setup required) |
| `meterless.test.ts` | 9 | 6 | **3** | Config, token and URL handling; `explain --model meterless` without a token and against a port nothing answers both print Setup required and exit 2; narrative citation checking. The 3 live tests skip: no `METERLESS_TOKEN` or runtime (Setup required) |
| `verify-bin.test.ts` | 2 | 2 | 0 | `release/blackbox-verify-0.1.0.tgz` matches a fresh `pnpm pack` of `packages/verify` file for file, has the bin and stays browser-safe; its bin, installed from the tarball, PASSes the committed PASS pack, FAILs the injection pack at step 3 with chain and seal intact, FAILs a one-byte-tampered copy at step 7, rejects another pinned key, exits 2 on usage errors |
| **Total** | **62** | **57** | **5** | Skipped tests print a `⚠️ SKIPPING LIVE … TESTS` banner, so a green run never implies a sponsor call happened |

## Other checks (all pass at this commit)

| Command | What |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` over every package, the tests and the web app |
| `pnpm lint` | ESLint 10 + typescript-eslint recommended |
| `pnpm build` | All packages and the Next.js app (including `/verify`) |
| `bash scripts/ci/verify-live-session.sh` | Records a real session through the bridge on this checkout: clean PASS, then a `.env.example` read FAILs at step 5, a tampered log FAILs at step 1, an empty session FAILs |
| `bash scripts/ci/verify-agent-demo.sh` | Re-verifies the committed live agent runs in `receipts/agent-demo/` from their exported files: one PASS, one FAIL at step 3 with chain and seal intact |
| `bash scripts/demo-attest-diff.sh` | Three real branches in a temp clone gated by `scripts/ci/attest-diff-pr.sh`: agent/clean exit 0, agent/human-edit exit 1, agent/bypass exit 1 (committed output: `receipts/attest-diff-demo/`) |

## Live runs (not part of `pnpm test`)

- `scripts/demo-agent.sh`: a real LLM agent (opencode 1.18.31, OpenRouter `minimax/minimax-m3.1-flash:free`) restricted to the proxy's tools, against `examples/injection-repo`. Two runs are committed under `receipts/agent-demo/` (README "Live agent run").
- `packages/proxy/dist/bench.js`: per-call overhead, 20 sessions × 25 calls, real measurements in `docs/benchmark.json` (about 0.7 ms per call).
- `npx ./blackbox-verify-0.1.0.tgz pack.json`, run on 2026-10-21 from an empty directory with the tarball and the PASS run's pack (npx fetched `@noble/curves` and `@noble/hashes` from npm): PASS, exit 0; the same pack with one hex digit of step 7's `resultHash` changed: `FAIL at step 7: Receipt contents were changed`, exit 1.
- Browser, second pass (2026-10-21, headless Chrome at 375 px against `next start` on a real recorded session): `/recorder`, `/verify` (empty, FAIL sample, one byte flipped) and the step drawer on `/` and `/recorder` have no horizontal overflow; screenshots in the team's notes folder.
- Browser: `/verify` was checked in a real browser against `next start`: both sample packs, a one-byte flip at step 7 (Broken, then Untrusted after it), no network request after page load, and no horizontal overflow at 375 px.
