# Demo script (~2:30)

## Preparation

1. Run `pnpm build`, then start `pnpm dev` and `pnpm --filter @blackbox/proxy start` in separate terminals.
2. Connect an MCP client to `packages/proxy/dist/server.js` using stdio. Make actual calls to `git` (`status`), `read_file` on a non-secret workspace file, and `shell` (`pwd`). Do not preload or seed receipts.
3. Open `http://localhost:3000` and confirm the live records appear.

## Run of show

- **0:00 — Why receipts?** An agent made a change. Who approved it, and did it access secrets? A trace is only useful if its integrity can be checked.
- **0:20 — Real calls.** Invoke the MCP tools live and show signed entries arriving in the timeline. Expand a row to show its chain link and proxy signature.
- **1:00 — Property proof.** Click **Verify session**; show that every receipt verifies and each receipt hash has a valid Merkle membership path under the displayed root.
- **1:30 — Tamper evidence.** Click **Run tamper demo**; show the modified stored record identified as the first broken receipt.
- **2:00 — Storage and trust limits.** Upload through the Walrus button only when a funded publisher is configured. Explain the proxy key is not a TEE and the root is not independently chain-anchored in this MVP.

## GitLab Duo run

This demo needs the GitLab Duo Agent Platform flow configured to use a network-reachable MCP proxy. Configure that endpoint and entitlement before presenting a Duo session. This repo does not include credentials or claim a completed Duo integration.
