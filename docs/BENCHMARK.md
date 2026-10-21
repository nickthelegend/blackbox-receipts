# Proxy overhead

What recording costs per tool call: the same real stdio MCP server
(`test/fixtures/upstream-server.mjs`, `echo` tool, reply delay off) called directly and through
`blackbox-proxy --upstream`, with sequential calls so each number is one call's round trip. The
difference covers planning the call, the policy check, salting and hashing, Ed25519 signing, the
cross-process lock and the two appends (receipt and witness) to disk.

Measured 2026-10-21 with `node packages/proxy/dist/bench.js --sessions 20 --calls 25`: 20 sessions
(each a fresh proxy process), 25 calls each, 500 calls per side. Apple M4 (10 cores), macOS arm64,
Node v26.5.0, receipts on the internal SSD. Another build was running on the machine at the same time,
so treat the tail as noisy. Raw output: [benchmark.json](benchmark.json).

| ms per call | mean | p50 | p95 | max |
|---|---|---|---|---|
| direct to the MCP server | 0.069 | 0.057 | 0.144 | 0.560 |
| through the Blackbox proxy | 0.766 | 0.616 | 1.596 | 5.924 |
| **overhead** | **0.697** | **0.558** | | |

So recording adds about 0.6–0.7 ms per call on this machine, small next to an LLM turn (seconds) or
most real tools. It doesn't include process start-up: the one-shot `call` bridge used by GitLab Duo
flows starts a proxy per call, which costs far more than the recording itself.

Rerun: `pnpm build && pnpm --filter @blackbox/proxy bench -- --sessions 20 --calls 25 --out docs/benchmark.json`.
