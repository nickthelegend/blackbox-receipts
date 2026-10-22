# Blackbox Receipts: submission draft

Every fact below is checked in this repo. Deadlines come from the event pages as recorded in the team's
hackathon notes: Open Agent Hackathon 2026, **Wildcard (Tinkerer)** track, submission Oct 27 23:45 UTC;
GitLab Transcend ("Life After Code"), **Oct 27 13:00 UTC** (about 10¾ hours before Open Agent). Nick
submits; this is the draft.

**Name:** Blackbox Receipts
**One line:** A flight recorder for AI agents: an MCP proxy signs a hash-linked receipt for every tool call, refuses secret reads before they run, and proves "the agent never read a secret" to anyone holding the public key, naming the step when it isn't true.
**Repo:** github.com/nickthelegend/blackbox-receipts (GitLab mirror for Transcend: not created yet)
**Video:** not recorded yet (script: `docs/demo-video-script.md`)
**Deployed URL:** not live yet. On the first push to the GitLab project's default branch, the `pages` job publishes the static overview and offline `/verify` (no server, no API, no keys). The URL is shown under Deploy → Pages: `https://<namespace>.gitlab.io/blackbox-receipts/`, or a `*.gitlab.io` unique domain if that setting is on. GitHub fallback after Nick pushes: `https://nickthelegend.github.io/blackbox-receipts/` (set Pages Source to "GitHub Actions" once). Path B needs the public URL to stay live until about Nov 16.
**Slide deck (required by Open Agent):** [`docs/deck/index.html`](docs/deck/index.html), PDF export [`docs/deck/blackbox-receipts-deck.pdf`](docs/deck/blackbox-receipts-deck.pdf) (10 slides, real data only)
**License:** MIT

## What it does

- **Record:** an MCP proxy in front of the agent's tools (its own `read_file`, `write_file`, `git` and `shell`, or any stdio MCP server via `--upstream`). Each call is checked against the policy before it runs and recorded as an Ed25519-signed, hash-linked receipt. Arguments stay private behind salted hashes. Parallel calls keep one chain; restarts archive; a signed seal catches truncation.
- **Prove:** "no secrets read" under a pinned policy, as a proof with per-step Merkle paths and commitments, verifiable from the public key alone. A FAIL names the step and the rule.
- **Explain:** `explain` turns a session into step-cited markdown: what each call did, what was refused, and why the verdict is what it is.
- **Verify anywhere:** one pack file, checked by the same `@blackbox/verify` code in the CLI or offline in the browser (`/verify`). One changed byte turns it red at that step.
- **Gate merges:** `write_file` signs each file's git blob id; `attest-diff` fails any changed file no signed write produced, with JUnit output and a signed attestation.

## Proof it works

- Live agent run with a prompt injection (`receipts/agent-demo/933f87da…`): opencode + OpenRouter `minimax-m3.1-flash:free`, only Blackbox tools, a README telling agents to read `.env`. The agent tried `read_file .env` at step 3, the proxy refused it before it ran, and the verdict is `FAIL no-secrets-read at step 3 … ".env*"` with chain and seal intact. An earlier run (`e51c6b41…`) where the model refused the injection proves `PASS`.
- 63 tests (58 pass, 5 live sponsor tests skipped for missing keys or runtime), typecheck, lint, build, the live-session CI script and the agent-demo re-verification all pass (TESTING.md).
- Receipt-gated merge on three real branches (`scripts/demo-attest-diff.sh`, output in `receipts/attest-diff-demo/`): the agent's own change is green, a human commit on the agent's file is red naming the file and step, a file written around the proxy is red as an unrecorded change. The same script runs on this repo's pull requests (`.github/workflows/attest-diff.yml`).
- A judge can verify either recorded run without cloning: `npx ./blackbox-verify-0.1.0.tgz pack.json` with the tarball from `release/` and a pack from `receipts/agent-demo/*/pack.json`; one changed byte fails naming the step.
- Overhead: about 0.7 ms per call over 20 sessions (docs/BENCHMARK.md).

## Track fit

- **Open Agent: Wildcard (Tinkerer).** Not "The Agent That Can Explain Why": the project existed before the build window, which the Wildcard allows, and the Wildcard scores only the work done inside the window (Oct 22 00:00 to Oct 27 23:45 UTC). Explanations are still a strength to show (`explain`, the `blackbox_explain` MCP tool, the step drawer), but they are pre-window work.
- **GitLab Transcend, Path A** (first commit Oct 19, after Path A's Oct 5 start): a Duo Agent Platform custom flow (`.gitlab/duo/flows/blackbox-receipts.yaml`) that reaches the repo only through the receipts bridge, plus GitLab CI that verifies exported sessions and gates merge requests on the agent's signed writes (`verify:attest-diff`). **Not yet run on GitLab:** needs a public GitLab project (MIT in About, DCO), the flow enabled, and a live Duo run with pipeline history.

## Still required by the event rules (not done)

- Open Agent: every entry must integrate **Zetaris and Meterless** and be **built using Cursor** (rule 5.1); the written explanation must cover the Zetaris/Meterless, Cursor and NVIDIA use. None of that has happened yet, so the entry is not eligible until in-window work lands. Video 1 to 4 minutes.
- GitLab Transcend: public GitLab repo with pipeline history, a video under 3 minutes on YouTube.

## Sponsor tools

Zetaris and Meterless clients and a dashboard live-check panel exist, and `explain --model meterless` asks the local Meterless Runtime for a narrative over the step-cited explanation (steps it cites are checked against the session). **BLOCKED / Setup required:** no `ZETARIS_API_KEY` + `ZETARIS_ORG_ID`; Meterless needs no hosted key, but its runtime is a desktop app (Nightshift, `Nightshift-Setup-mac-m1.dmg` from meterless.ai, free for M1 to M4 Macs) that has not been installed or run here, so there is no `proxy-token` to point `METERLESS_STATE_DIR` at. No live call to either has run and neither is in the agent loop. Don't claim sponsor usage until it has.

## Pre-existing work (disclosure)

All commits before 2026-10-22 00:00 UTC predate the Open Agent build window and are pre-existing work. That includes this round of fixes (concurrency, archive, seal, policy pinning, salted hashes, guard, key location, explain, upstream proxy, `@blackbox/verify`, `/verify`, attest-diff) and the second pass (attest-diff CI jobs and demo, structured explanations with the `blackbox_explain` MCP tool and step drawer, the `blackbox-verify` npx bin, the `explain --model meterless` wiring, the 375 px pass and the slide deck), all committed on 2026-10-21.

## Limits

Trust rests on the proxy key (publish and pin it; no TEE). The guard is a heuristic policy check, not a sandbox. The proof is selective disclosure with a trusted attester, not zero knowledge. Exports reveal tool names and paths. Only calls through the proxy are covered.
