# CLAUDE.md: notes for coding agents in this repo

Blackbox Receipts records signed, hash-linked receipts for an agent's MCP tool calls and proves
properties of a session ("no secrets read") that anyone can check with the public key.

## Layout (pnpm workspace, TypeScript, Node 20+)
- `packages/verify`: every check that needs no private key (chain, Merkle, seal, property proof, packs).
  No `node:` imports; Ed25519 and SHA-256 from `@noble/*`. Runs in the CLI and in the browser.
- `packages/receipts`: signing and proving (Node crypto, salted hashes, policy evaluation). Re-exports `@blackbox/verify`.
- `packages/proxy`: the stdio MCP proxy (`server.js`, built-in `read_file`/`write_file`/`git`/`shell`, or
  `--upstream "<cmd>"`), the store (lock, archive, seal, key in `~/.blackbox`), the CLI (`cli.js`), the one-shot
  bridge (`call.js`) and the benchmark (`bench.js`).
- `packages/zetaris`, `packages/meterless`: sponsor clients. No keys are configured; they report "Setup required".
- `apps/web`: Next.js dashboard (local-only API) and the offline `/verify` page.
- `test/`: node:test suites; fixtures in `test/fixtures` are for tests only.

## Commands
`pnpm install && pnpm build`, then `pnpm test`, `pnpm typecheck`, `pnpm lint`,
`bash scripts/ci/verify-live-session.sh`, `bash scripts/ci/verify-agent-demo.sh`.
Live agent demo: `bash scripts/demo-agent.sh` (opencode + an OpenRouter free model; prints "Setup required" otherwise).

## Rules
- No mocks of external APIs and no fake success: missing keys stay "Setup required"; live tests skip loudly.
- Never read or print signing keys, `.env` files or API keys. Tests use throwaway `BLACKBOX_KEY_DIR`s.
- Receipts and exports under `receipts/` come from real runs only. Don't hand-edit them.
- One logical change per commit; MIT, `Copyright (c) 2026 Nivesh Gajengi`.
