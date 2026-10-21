# Demo script (~2:30)

## Preparation

1. Run `pnpm build`, then start `pnpm dev` and `pnpm --filter @blackbox/proxy start` in separate terminals. Starting the proxy archives the previous session under `.blackbox/sessions/`; nothing needs deleting.
2. Connect an MCP client to `packages/proxy/dist/server.js` using stdio (or run `bash scripts/demo-agent.sh` for a real LLM agent against the injection fixture). Make actual calls to `git` (`status`), `read_file` on a non-secret workspace file, and `shell` (`pwd`). Do not preload or seed receipts.
3. Open `http://localhost:3000` and confirm the live records appear.

## Run of show

- **0:00 — Why receipts?** An agent made a change. What did it touch, and did it access secrets? A trace is only useful if its integrity can be checked.
- **0:20 — Real calls.** Invoke the MCP tools live and show signed entries arriving in the timeline. Expand a row to show its chain link and proxy signature.
- **1:00 — Property proof.** Click **Prove: no secrets read**. Show PASS with a leaf, signature, Merkle path and commitment per step, and no raw args. Then have the agent read `.env.local` and prove again: FAIL names that step.
- **1:30 — Tamper evidence.** Click **Run tamper demo**, then **Prove** again. The chain breaks at the edited block and the proof fails at that step. Then open `/verify`, load a pack and flip one byte to show the same check running offline in the browser.

The recorded 2-minute version for Open Agent is in `docs/demo-video-script.md`.
- **2:00 — Storage and trust limits.** Upload through the Walrus button only when a funded publisher is configured. Explain the proxy key is not a TEE and the root is not independently chain-anchored in this MVP.

## GitLab Duo run

Follow [gitlab-setup.md](gitlab-setup.md) to create and enable the custom flow. On a real MR, mention the flow's service account and show the note it posts (answer, step-cited "Why", PASS/FAIL line), then the `verify:exported-receipts` job on the pushed receipts branch. For the failure case, ask it to read `.env.example`, or edit a line of the exported `session.jsonl`, and show the red pipeline naming the step. Until such a run has happened on GitLab, don't present a Duo session.
