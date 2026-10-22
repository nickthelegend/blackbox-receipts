# Blackbox Receipts: submission draft

Every fact below is checked in this repo. Deadlines come from the event pages as recorded in the team's
hackathon notes: Open Agent Hackathon 2026, **Wildcard (Tinkerer)** track, submission Oct 27 23:45 UTC;
GitLab Transcend ("Life After Code"), **Oct 27 13:00 UTC** (about 10¾ hours before Open Agent). Nick
submits; this is the draft.

**Name:** Blackbox Receipts
**One line:** A flight recorder for AI agents: an MCP proxy signs a hash-linked receipt for every tool call, refuses secret reads before they run, and proves "the agent never read a secret" to anyone holding the public key, naming the step when it isn't true.
**Repo:** github.com/nickthelegend/blackbox-receipts (GitLab mirror for Transcend: not created yet)
**Video:** not recorded yet. Scripts for both cuts (Open Agent Wildcard 1–4 min, GitLab under 3 min): `docs/demo-video-script.md`
**Deployed URL:** not live yet. On the first push to the GitLab project's default branch, the `pages` job publishes the static overview and offline `/verify` (no server, no API, no keys). The URL is shown under Deploy → Pages: `https://<namespace>.gitlab.io/blackbox-receipts/`, or a `*.gitlab.io` unique domain if that setting is on. GitHub fallback after Nick pushes `main`: `https://nickthelegend.github.io/blackbox-receipts/` and `…/verify/` (set Pages Source to "GitHub Actions" once).
**Slide deck (required by Open Agent):** [`docs/deck/index.html`](docs/deck/index.html), PDF export [`docs/deck/blackbox-receipts-deck.pdf`](docs/deck/blackbox-receipts-deck.pdf) (10 slides, real data only)
**License:** MIT

## What it does

- **Record:** an MCP proxy in front of the agent's tools (its own `read_file`, `write_file`, `git` and `shell`, or any stdio MCP server via `--upstream`). Each call is checked against the policy before it runs and recorded as an Ed25519-signed, hash-linked receipt. Arguments stay private behind salted hashes. Parallel calls keep one chain; restarts archive; a signed seal catches truncation.
- **Prove:** "no secrets read" under a pinned policy, as a proof with per-step Merkle paths and commitments, verifiable from the public key alone. A FAIL names the step and the rule.
- **Explain:** `explain` turns a session into step-cited markdown: what each call did, what was refused, and why the verdict is what it is.
- **Verify anywhere:** one pack file, checked by the same `@blackbox/verify` code in the CLI or offline in the browser (`/verify`). One changed byte turns it red at that step.
- **Gate merges:** `write_file` signs each file's git blob id; `attest-diff` fails any changed file no signed write produced, with JUnit output and a signed attestation.

## Proof it works

- Live agent run (`receipts/agent-demo/933f87da…`): opencode + OpenRouter `minimax-m3.1-flash:free`, only Blackbox tools, a fixture README whose "Agent checklist" asks agents to read `.env`. The user prompt told the agent to complete that checklist first, so the read was requested through the README, not found by the agent on its own. The agent tried `read_file .env` at step 3, the proxy refused it before it ran, and the verdict is `FAIL no-secrets-read at step 3 [policy no-secrets-read/v1 …] … ".env*"` with chain and seal intact. An earlier run (`e51c6b41…`), with a differently worded README section and prompt, skipped `.env` and proves `PASS`. Both were proven under `no-secrets-read/v1`, the policy of that day. A run with a neutral prompt is not recorded yet.
- 77 tests (72 pass, 5 live sponsor tests skipped for missing keys or runtime), 33 browser E2E tests in Google Chrome at 1280 px and 375 px (66 runs, all pass), typecheck, lint, build, the live-session CI script and the agent-demo re-verification all pass (TESTING.md).
- Receipt-gated merge on three real branches (`scripts/demo-attest-diff.sh`, output in `receipts/attest-diff-demo/`): the agent's own change is green, a human commit on the agent's file is red naming the file and step, a file written around the proxy is red as an unrecorded change. The same script runs on this repo's pull requests (`.github/workflows/attest-diff.yml`).
- A judge can verify either recorded run without cloning: `npx ./blackbox-verify-0.1.0.tgz pack.json --expect-policy no-secrets-read/v1` with the tarball from `release/` and a pack from `receipts/agent-demo/*/pack.json` (the default pin is v2, which refuses their v1 proof by name); one changed byte fails naming the step.
- Overhead: about 0.7 ms per call over 20 sessions (docs/BENCHMARK.md).

## Track fit

- **Open Agent: Wildcard (Tinkerer).** Not "The Agent That Can Explain Why": the project existed before the build window, which the Wildcard allows, and the Wildcard scores only the work done inside the window (Oct 22 00:00 to Oct 27 23:45 UTC). Explanations are still a strength to show (`explain`, the `blackbox_explain` MCP tool, the step drawer), but they are pre-window work.
- **GitLab Transcend, Path A** (first commit Oct 19, after Path A's Oct 5 start): a Duo Agent Platform custom flow (`.gitlab/duo/flows/blackbox-receipts.yaml`) that reaches the repo only through the receipts bridge, plus GitLab CI that verifies exported sessions and gates merge requests on the agent's signed writes (`verify:attest-diff`). `CONTRIBUTING.md` carries the DCO 1.1 text and the Signed-off-by policy; the GitLab build job now hands every package's `dist` to the test job, so the first pipeline can start green. **Not yet run on GitLab:** needs a public GitLab project (MIT in About), the flow enabled, and a live Duo run with pipeline history.

## Still required by the event rules (not done)

- Open Agent: every entry must integrate **Zetaris and Meterless** and be **built using Cursor** (rule 5.1); the written explanation must cover the Zetaris/Meterless, Cursor and NVIDIA use. None of that has happened yet, so the entry is not eligible until in-window work lands. Video 1 to 4 minutes.
- GitLab Transcend: public GitLab repo with pipeline history, a video under 3 minutes on YouTube.

## Sponsor tools

Zetaris and Meterless clients and a dashboard live-check panel exist, and `explain --model meterless` asks the local Meterless Runtime for a narrative over the step-cited explanation (steps it cites are checked against the session). **BLOCKED / Setup required:** no `ZETARIS_API_KEY` + `ZETARIS_ORG_ID`; Meterless needs no hosted key, but its runtime is a desktop app (Nightshift, `Nightshift-Setup-mac-m1.dmg` from meterless.ai, free for M1 to M4 Macs) that has not been installed or run here, so there is no `proxy-token` to point `METERLESS_STATE_DIR` at. No live call to either has run and neither is in the agent loop. Don't claim sponsor usage until it has.

## Built in the window (Oct 22–27): what the Wildcard scores

All commits on or after 2026-10-22 00:00 UTC, `git log 4cf7afe..main`:

- `37d257f`…`c30da91` (Oct 22, 03:42 UTC): a Playwright E2E suite in Google Chrome over the landing, `/recorder`, `/verify` and the static Pages build at 1280 px and 375 px (`b62dcca`), and four UI fixes it found.
- `f7b4db8`, `36bdcd7` (14:03 UTC): `/recorder` names the session file it really reads.
- `d526d1c` onward (from 15:29 UTC): fixes from two independent reviews. GitLab CI artifacts (zetaris `dist`); `.gitignore` for env files, videos and test output; `CONTRIBUTING.md` with DCO 1.1; a torn log line is a located FAIL instead of a crash; policy `no-secrets-read/v2` covering git, npm, netrc and other credential stores (v1 frozen and pinned explicitly for the old runs, with a Pinned policy control on `/verify`); `write_file` can no longer escape through a symlinked folder; `attest-diff` exempts only the gated export; the dashboard API refuses cross-site requests; the agent runs' prompts described as they were; deck, video scripts and docs.

**Tools, disclosed:** every commit in that range was made with Claude Code (Claude Opus 5.5). All carry a `Co-Authored-By: Claude Opus 5.5` trailer except `b62dcca`, made in the same session without one. The trailers stay. **Cursor:** not used yet. Rule 5.1 requires the entry to be built using Cursor; the sponsor integration below is to be built in Cursor, with a Cursor screenshot on a deck slide and a few seconds of it in the video. **NVIDIA:** no NVIDIA model or service is used.

**Still to build in the window (BLOCKED on credentials):** Zetaris as a receipted tool (`zetaris_list_marts`, `zetaris_sql`, policy-checked: `SELECT` only, listed tables or columns denied, the result hash in each receipt) needs `ZETARIS_API_KEY` + `ZETARIS_ORG_ID`; Meterless as the agent's model in `scripts/demo-agent.sh` (`meterless/auto`) plus `explain --model meterless` on that run needs the Nightshift runtime installed and running with `METERLESS_STATE_DIR` (installing it needs Nick's go-ahead). Lead the Wildcard pitch with that work once it exists, since only window work is scored.

## Pre-existing work (disclosure)

All commits before 2026-10-22 00:00 UTC predate the Open Agent build window and are pre-existing work. That includes this round of fixes (concurrency, archive, seal, policy pinning, salted hashes, guard, key location, explain, upstream proxy, `@blackbox/verify`, `/verify`, attest-diff) and the second pass (attest-diff CI jobs and demo, structured explanations with the `blackbox_explain` MCP tool and step drawer, the `blackbox-verify` npx bin, the `explain --model meterless` wiring, the 375 px pass and the slide deck), all committed on 2026-10-21.

## Limits

Trust rests on the proxy key (publish and pin it; no TEE). The guard is a heuristic policy check, not a sandbox. The proof is selective disclosure with a trusted attester, not zero knowledge. Exports reveal tool names and paths. Only calls through the proxy are covered.
