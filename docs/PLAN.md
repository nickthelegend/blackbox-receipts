# Blackbox Receipts: build plan

**Targets:** Open Agent (sign up by **Oct 20**; sprint Oct 22–27; "The Agent That Can Explain Why" track) and GitLab Transcend (**Oct 27**, $45k, GitLab Duo Agent Platform). Later: Tatum x Walrus (Nov 10, 17:00 UTC), Decentralize AI (Feb 27, 2027).

## Weak spots to fix
1. **Novelty 6/10.** The idea is publicly suggested, so a trace viewer won't win. Fix: make tamper evidence and proving a property the headline.
2. **"Why should I trust the signer?"** Fix: per-step signatures with a device key held by the proxy, not the agent. Document a TEE as future work rather than faking one.
3. **GitLab rules need the Duo Agent Platform.** Fix: the GitLab entry must be a real Duo flow that calls the proxy.

## Architecture
```
agent (Duo flow / MCP client)
   │ tool calls
   ▼
receipts-proxy (MCP proxy, TypeScript)
   ├─ policy checker (YAML rules: forbidden paths, secrets, prod targets)
   ├─ receipt = {step, tool, args_hash, perms, cost, approver, result_hash, prev_hash}
   ├─ ed25519 signature per receipt, Merkle root per session
   ▼
store: Postgres (index) + Walrus blob (session log) + root anchored on an EVM testnet
   ▼
web UI (Next.js): timeline · verify chain · "prove property" · tamper demo
```
"Prove no secrets were read" v1 is a Merkle proof that every receipt in the session has `secrets_accessed=false`, plus a signed root. That's selective disclosure: show a leaf and its path without the full log. ZK comes later.

## MVP scope (must ship)
- An MCP proxy that wraps real tools (git, file read, shell) and emits signed, chained receipts.
- A verifier CLI and UI: recompute the chain, mark any broken link red.
- One property query: "no access to paths matching `secrets/**` or `.env`".
- A GitLab Duo flow (Path A) that fixes an issue in a real repo, with every call routed through the proxy.
- Session root pinned to Walrus; blob ID shown in the UI.

**Out of scope:** TEE attestation, ZK circuits, multi-tenant auth, billing.

## Day-by-day
| Date | Work |
|---|---|
| Oct 19–20 | Register for Open Agent. Read the GitLab Transcend rules. Scaffold the repo. Define the receipt schema and signing. |
| Oct 21 | MCP proxy wrapping 3 tools; hash chain and signatures; unit tests for chain verification. |
| Oct 22 | Policy checker plus the property query; Merkle proofs; verifier CLI. |
| Oct 23 | Next.js timeline UI, verify button, tamper demo (edit a stored line → red break). |
| Oct 24 | GitLab Duo flow integration on a real MIT repo; Walrus upload. |
| Oct 25 | Eval: run 20 real agent sessions and report chain-verify pass rates and overhead in ms per call. |
| Oct 26 | Polish, README, record the demo video (<3 min). |
| Oct 27 | Submit to GitLab Transcend and Open Agent. Buffer. |

## Demo script (≈2:30)
1. (0:00) The problem: "An agent merged this fix. Who approved it, and did it touch secrets?"
2. (0:20) Run the Duo flow live; receipts stream into the timeline.
3. (1:00) Click **Prove no secrets were read** → green, with a Merkle path shown.
4. (1:30) Edit one log line in the DB live → **Verify** → the chain breaks red at step N.
5. (2:00) Show the Walrus blob and the anchored root; close with overhead numbers from the eval.

## Risks and cuts
- **Duo platform access or learning curve:** keep a plain MCP-client agent as a fallback for Open Agent; for GitLab, cut scope everywhere else first.
- **Walrus integration slips:** anchor the root on an EVM testnet only, and save Walrus for the Nov 10 entry.
- **Time:** cut order is UI polish → on-chain anchor → property query. **Never cut** the tamper demo.
- No mock sessions in the final demo: the receipts must come from real agent runs.
