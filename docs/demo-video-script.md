# Demo video script: Open Agent, "The Agent That Can Explain Why"

**Length:** 2:00. **Narration:** about 290 words at a calm 145 wpm. **Format:** screen recording with voice-over; picture-in-picture is optional.

**Thesis for the judges:** an agent's explanation of what it did is only worth as much as the evidence behind it. Blackbox Receipts lets you ask a session a question ("did the agent ever read a secret?") and get a yes or no you can check, which names the step if the answer is no. The answer doesn't expose the agent's private arguments.

## Before you record

Everything on screen must come from real runs. Don't seed, script or edit receipts, except through the tamper button, which is the point of that scene.

1. `pnpm install && pnpm build && pnpm test`. Every test must pass.
2. Stop any running proxy and clear the old session: `rm -f .blackbox/session.jsonl .blackbox/witness.jsonl`.
3. Terminal A: `pnpm dev` (dashboard at `http://localhost:3000`).
4. Connect an MCP-capable agent (Claude Code, Cursor or any MCP client) to the proxy over stdio: command `node`, args `packages/proxy/dist/server.js`, with the repo as the working directory. Starting the proxy resets the session.
5. Keep a second terminal (B) open at the repo root for the CLI.
6. Have a `.env.local` file in the workspace so the secret-path scene has a real target. It never leaves the machine, because the proxy blocks the read.
7. Browser at 125% zoom, dark OS theme, notifications off. Record at 1080p.

If GitLab Duo is configured and exercised by recording day, use the Duo flow in scene 2 instead of the local MCP client. Otherwise don't mention Duo in this video.

## Run of show

| Time | Screen | Narration |
|---|---|---|
| 0:00–0:15 | Dashboard, empty state ("Nothing recorded yet"). | "Agents can now explain what they did. But when an agent says 'I never touched your secrets', you only have its word. We wanted explanations that come with receipts." |
| 0:15–0:40 | Split: agent chat on the left, dashboard on the right. Prompt the agent: *"Check git status, read README.md, then list the packages folder."* Receipts appear one by one. Expand one row: hash, previous hash, signature. | "Every tool call goes through the Blackbox proxy. The proxy, not the agent, signs each call with its own Ed25519 key and links it to the one before, so the session becomes a hash chain. The agent can't rewrite its own history." |
| 0:40–1:00 | Click **Prove: no secrets read**. The card turns green: *PASS: the agent never read secrets*, with *leaf · signature · Merkle path · commitment*. Click **Download proof JSON** and scroll it briefly. | "Now ask the question. The policy is secret file globs like dot-env, PEM files and the SSH folder, plus secret-token patterns in shell arguments. PASS. The proof holds a Merkle inclusion path and a property commitment for every step. Notice what's missing: the arguments themselves. You learn the answer, not the agent's private inputs." |
| 1:00–1:12 | Terminal B: `node packages/proxy/dist/cli.js verify-proof` prints `PASS no-secrets-read: N receipts proven under root …`. | "Anyone with the proxy's public key can check that proof offline with the verifier CLI." |
| 1:12–1:30 | Back in the agent: *"Read .env.local."* The proxy denies it and a new receipt appears. The proof card shows *Proof is stale*. Click **Prove** again: red *FAIL at step 4: read_file touched secret path matching ".env\*"*, and step 4 is highlighted in the timeline. | "Now the agent reaches for a secret. The proxy blocks it, but the attempt is still on the record. Run the proof again: FAIL, at step four, with the rule it broke. The explanation points at the exact step." |
| 1:30–1:48 | Click **Run tamper demo**, then **Prove** again: *FAIL at step 1: Chain verification failed: Receipt contents were changed*. The chain pill reads *BROKEN AT 1*. | "And if someone edits the log to hide that, here's a real edit to the stored file, the chain breaks at the edited step and no proof can be produced." |
| 1:48–2:00 | Slow push on the disclaimer line, then the repo URL. | "Honest limits: the proxy key attests to the policy check, so this isn't zero knowledge yet. A Noir circuit is next. Blackbox Receipts: agents that can explain why, and prove it." |

## Shot notes

- In scene 3, hover the downloaded JSON long enough to show `steps[].inclusion` and `commitment`, and show that no `path` or `command` fields appear anywhere.
- Scene 5 is the money shot. Leave the red FAIL card on screen for a full beat before you speak.
- If a take shows a different step number (for example, because the agent made an extra call), keep the real number and say it. Don't re-cut the narration to match an expected number.
- The empty-session failure ("No receipts exist for this session") is covered by the test suite. Show it only if time allows, by restarting the proxy and clicking **Prove** before any call.

## Claims checklist (read before you publish)

- [ ] Every receipt in the video came from a live agent session recorded that day.
- [ ] No claim of zero-knowledge proofs, TEE attestation, on-chain anchoring or a GitLab Duo run unless that feature was actually shown working.
- [ ] Walrus is not mentioned unless an upload went through a configured, funded publisher on camera.
- [ ] The video link is added to `README.md`.
