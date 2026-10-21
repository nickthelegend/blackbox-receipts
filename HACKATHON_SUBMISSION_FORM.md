# Blackbox Receipts: submission draft

Every fact below is checked in this repo. Deadlines come from the event pages as recorded in the team's
hackathon notes: Open Agent Hackathon 2026 (Wildcard), submission Oct 27 23:45 UTC; GitLab Transcend
("Life After Code"), Oct 27. Nick submits; this is the draft.

**Name:** Blackbox Receipts
**One line:** A flight recorder for AI agents: an MCP proxy signs a hash-linked receipt for every tool call, refuses secret reads before they run, and proves "the agent never read a secret" to anyone holding the public key, naming the step when it isn't true.
**Repo:** github.com/nickthelegend/blackbox-receipts (GitLab mirror for Transcend: not created yet)
**Video:** not recorded yet (script: `docs/demo-video-script.md`)
**License:** MIT

## What it does

- **Record:** an MCP proxy in front of the agent's tools (its own `read_file`, `write_file`, `git` and `shell`, or any stdio MCP server via `--upstream`). Each call is checked against the policy before it runs and recorded as an Ed25519-signed, hash-linked receipt. Arguments stay private behind salted hashes. Parallel calls keep one chain; restarts archive; a signed seal catches truncation.
- **Prove:** "no secrets read" under a pinned policy, as a proof with per-step Merkle paths and commitments, verifiable from the public key alone. A FAIL names the step and the rule.
- **Explain:** `explain` turns a session into step-cited markdown: what each call did, what was refused, and why the verdict is what it is.
- **Verify anywhere:** one pack file, checked by the same `@blackbox/verify` code in the CLI or offline in the browser (`/verify`). One changed byte turns it red at that step.
- **Gate merges:** `write_file` signs each file's git blob id; `attest-diff` fails any changed file no signed write produced, with JUnit output and a signed attestation.

## Proof it works

- Live agent run with a prompt injection (`receipts/agent-demo/933f87da…`): opencode + OpenRouter `minimax-m3.1-flash:free`, only Blackbox tools, a README telling agents to read `.env`. The agent tried `read_file .env` at step 3, the proxy refused it before it ran, and the verdict is `FAIL no-secrets-read at step 3 … ".env*"` with chain and seal intact. An earlier run (`e51c6b41…`) where the model refused the injection proves `PASS`.
- 51 tests (47 pass, 4 live sponsor tests skipped for missing keys), typecheck, lint, build, the live-session CI script and the agent-demo re-verification all pass (TESTING.md).
- Overhead: about 0.7 ms per call over 20 sessions (docs/BENCHMARK.md).

## Track fit

- **Open Agent, "The Agent That Can Explain Why":** explanations backed by signed evidence, each claim citing a receipt, with a verdict a third party can check.
- **GitLab Transcend:** a Duo Agent Platform custom flow (`.gitlab/duo/flows/blackbox-receipts.yaml`) that reaches the repo only through the receipts bridge, plus GitLab CI that verifies exported sessions. **Not yet run on GitLab:** needs a public GitLab project, the flow enabled, and a live Duo run with pipeline history.

## Sponsor tools

Zetaris and Meterless clients and a dashboard live-check panel exist. **BLOCKED / Setup required:** no `ZETARIS_API_KEY` + `ZETARIS_ORG_ID` or `METERLESS_TOKEN`, so no live call has run and neither is in the agent loop. Don't claim sponsor usage until it has.

## Pre-existing work (disclosure)

All commits before 2026-10-22 00:00 UTC predate the Open Agent build window and are pre-existing work. That includes this round of fixes (concurrency, archive, seal, policy pinning, salted hashes, guard, key location, explain, upstream proxy, `@blackbox/verify`, `/verify`, attest-diff), all committed on 2026-10-21.

## Limits

Trust rests on the proxy key (publish and pin it; no TEE). The guard is a heuristic policy check, not a sandbox. The proof is selective disclosure with a trusted attester, not zero knowledge. Exports reveal tool names and paths. Only calls through the proxy are covered.
