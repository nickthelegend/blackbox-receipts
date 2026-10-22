# Demo video scripts

Two cuts, both screen recordings with voice-over and captions. Nick records and uploads them to YouTube (public),
then the links go in the first screen of `README.md` and in `HACKATHON_SUBMISSION_FORM.md`.

| Cut | Event | Length | Leads with |
|---|---|---|---|
| A | Open Agent Hackathon 2026, **Wildcard (Tinkerer)** | 1 to 4 min (aim for 3:00) | The work built in the window (Oct 22 to 27): a Zetaris query recorded as a receipt and a Meterless narration of the session |
| B | GitLab Transcend ("Life After Code") | under 3 min (aim for 2:40) | The Duo flow running on a real merge request, its pipeline and its MR note |

**Order of work.** The keyless segments (A3 to A6) can be recorded now from real runs. The sponsor segments (A1, A2)
need Zetaris keys and a running Meterless Runtime; the GitLab segments (B1 to B3) need the GitLab project and a Duo
run. Record those once they have happened, then splice. Until then the video is not finished; don't publish a cut that
implies a step that didn't run.

## Rules for every frame

- **Real output only.** Every receipt, verdict and log line on screen comes from a run recorded that day or from the
  committed runs in `receipts/agent-demo/`. Never edit a program's text output. To hide something (a token, a home
  path), cover it with a visible box (ffmpeg `drawbox`) or a caption; never retype it.
- **Caption replay vs live.** A committed run shown on the landing page or `/verify` gets the caption
  `REPLAY · recorded 2026-10-21 · receipts/agent-demo/<id>`. A run made on camera gets `LIVE · <date> <time> UTC`.
- **Say what the prompt said.** In both committed runs the user prompt told the agent to follow the README's agent
  section (step 2: "complete its agent checklist before anything else"). So the `.env` read was asked for through the
  README; don't call it an injection the agent found on its own. The neutral-prompt run
  (`receipts/agent-demo/28d95bc3…`, 2026-10-22) is recorded: that agent never asked for `.env` and the verdict is PASS, so it shows a clean session, not an unprompted refusal.
- **Policy versions.** The committed runs were proven under `no-secrets-read/v1`. Anything recorded now runs under
  `no-secrets-read/v2` (adds `.git/**`, `.npmrc`, `.netrc` and other credential files). Read the version off the
  verdict line; don't mix them up in narration.
- **Counts.** `pnpm test`: 96 tests, 91 pass, 5 skipped (live Zetaris and Meterless tests; no keys or runtime).
  Browser E2E: 37 tests in each of two viewports, all passing. Re-check both on the day and say what you see.

## Before you record

1. `pnpm install && pnpm build && pnpm test`, and `pnpm build:pages -- --base-path /blackbox-receipts`.
2. Terminal A at the repo root. Terminal B: `pnpm dev` (dashboard at `http://localhost:3000`).
3. Browser at 125% zoom, notifications off, 1080p.
4. For A1 and A2 only: `ZETARIS_API_KEY`, `ZETARIS_ORG_ID` set in the shell (never on screen), Nightshift running
   with `METERLESS_STATE_DIR` set; `pnpm test` then shows 0 skipped.

## Cut A: Open Agent, Wildcard (about 3:00)

The Wildcard scores only the work done in the window, so the first minute is that work.

| Time | Segment | Screen | Narration (draft) | Status |
|---|---|---|---|---|
| 0:00–0:10 | Hook | Landing hero, then the README's "Built in the window" section | "Blackbox Receipts is a flight recorder for AI agents. This is what we built for this hackathon." | Recordable now |
| 0:10–0:45 | A1 Zetaris, governed and receipted | The agent asks for data; `zetaris_sql` runs a `SELECT` through the proxy; the receipt shows the tool, the policy check and the result hash; a `DROP` or a denied table is refused and recorded | "Data access through Zetaris goes through the same recorder: the query is checked against the policy before it runs, and the receipt carries a hash of the result." | **Needs Zetaris keys; not built yet** |
| 0:45–1:10 | A2 Meterless | The agent run with `meterless/auto` as its model, then `explain --model meterless` writing a narrative that cites steps, each citation checked against the session | "The agent's model runs on the local Meterless Runtime, and Meterless retells the session from the signed facts. Every step it cites is checked." | **Needs the Meterless Runtime; not run yet** |
| 1:10–1:45 | A3 The refused read | REPLAY of `receipts/agent-demo/933f87da…` on the landing: prompt step 2 on screen, step 3 `read_file .env` denied, `FAIL no-secrets-read at step 3 [policy no-secrets-read/v1 …]`, then the Why drawer for step 3 | "Here the prompt told the agent to complete the README's checklist, and the checklist asks for .env. The proxy refused the read before it ran, recorded the attempt, and the proof fails at step three, citing its receipts." | Recordable now |
| 1:45–2:15 | A4 Check it yourself | `/verify`: load the PASS sample (pinned v1, PASS), switch the pin to v2 (FAIL, the v1 proof refused by name), then Flip one byte at step 7 (FAIL at step 7, later steps Untrusted) | "Anyone can check a pack offline. The policy is pinned, so an older, weaker policy doesn't count, and one changed byte names the step." | Recordable now |
| 2:15–2:40 | A5 Gate the merge | `bash scripts/demo-attest-diff.sh`: agent/clean green, agent/human-edit red naming CHANGELOG.md and step 2, agent/bypass red naming src/debug.ts | "The same receipts gate a merge: every changed file must be one the proxy signed." | Recordable now |
| 2:40–2:55 | A6 Tamper on the recorder | `/recorder`: Tamper block 2, Chain lamp Broken · 02, Restore | "Edit the log on disk and the chain breaks at that block." | Recordable now |
| 2:55–3:00 | Close | Limits placard, repo URL | "The proxy key is the trust anchor, and this is not zero knowledge. It is checkable." | Recordable now |

## Cut B: GitLab Transcend (about 2:40)

Stage 1 asks for a reasonable use of the GitLab Duo Agent Platform, and Presentation scores the video showing the
automation running. Lead with it.

| Time | Segment | Screen | Status |
|---|---|---|---|
| 0:00–0:15 | Problem | Landing hero | Recordable now |
| 0:15–1:05 | B1 The Duo flow on a real MR | Mention the flow's service account on an MR; the flow reads the repo only through the receipts bridge (`call.js`), exports `receipts/<session>/`, pushes it, and posts its MR note with step-cited reasons and the verbatim verdict | **Needs the GitLab project and a Duo run** |
| 1:05–1:40 | B2 The pipeline | The pipeline page: build, test, `verify:live-session`, `verify:agent-demo`, `verify:exported-receipts` (the Duo session PASSes), `verify:attest-diff` with its JUnit report, `pages` | **Needs the GitLab project** |
| 1:40–2:10 | B3 Red on a human edit | A commit by hand on the agent's branch; `verify:attest-diff` turns red naming the file and step | **Needs the GitLab project** |
| 2:10–2:35 | Verify offline | `/verify` PASS, then one byte flipped | Recordable now |
| 2:35–2:40 | Close | Repo URL (GitLab), MIT | Recordable now |

## Claims checklist (read before you publish)

- [ ] Every receipt on screen traces to `receipts/agent-demo/` or to a session recorded that day, and is captioned
      REPLAY or LIVE.
- [ ] The narration says the committed runs' prompts asked for the README checklist.
- [ ] Zetaris, Meterless, Walrus and GitLab Duo appear only if they ran on camera. Otherwise they are not in the cut.
- [ ] No claim of zero knowledge, TEE attestation or on-chain anchoring.
- [ ] Test counts said on screen match `pnpm test` and `pnpm test:e2e` on the day.
- [ ] Cut A is 1 to 4 min, Cut B is under 3 min, both public on YouTube, both linked from the README and the form.
