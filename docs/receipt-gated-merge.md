# Receipt-gated merge

The proxy's `write_file` tool signs the git blob id (`git hash-object`) of every file it writes into
that step's receipt (`artifacts: [{ path, blob }]`). `attest-diff` then compares a change set with the
log:

```
node packages/proxy/dist/cli.js attest-diff --base <sha> [--from receipts/<session>] \
  [--junit attest-diff.xml] [--out attest-diff.json] [--ignore path/**]
```

For every file changed since `<sha>` (committed, uncommitted or untracked), the file's current blob must
equal the latest blob a signed, successful `write_file` step recorded for that path:

| Situation | Result |
|---|---|
| The agent wrote it through the proxy and nobody touched it since | `ok matches the write signed at step N` |
| Someone edited it after the agent's write | `FAIL src/a.ts changed after its recorded write (step N wrote …, the file is now …)` |
| It changed with no recorded write (a human, or an agent writing around the proxy) | `FAIL unrecorded change: src/x.ts` |
| It was deleted | `FAIL unrecorded change: src/x.ts was deleted` (no signed step deletes files) |

Before comparing, the receipts are checked: the chain must verify, an export's seal must match exactly,
and with `BLACKBOX_PUBLIC_KEY` set the export's key must be the pinned one. `receipts/**`, `.blackbox/**`
and the command's own output files are ignored. `--junit` writes one test case per file for CI test
reports; `--out` writes a JSON attestation (base, HEAD, session, Merkle root, per-file verdicts) signed
with the key of whoever runs the command, whose public key it embeds.

CI job examples: [examples/ci/receipt-gated-merge.github.yml](../examples/ci/receipt-gated-merge.github.yml)
and [examples/ci/receipt-gated-merge.gitlab-ci.yml](../examples/ci/receipt-gated-merge.gitlab-ci.yml).
They are examples only; neither runs in this repo.

Limits: the gate proves where each changed byte came from, not that the change is good. It trusts the
proxy key (pin it). Renames show up as a delete plus an add, so a rename fails unless the new file was
written through `write_file` and the delete is accepted by hand. The attestation's signer is the CI
runner's key unless you provide one with `RECEIPTS_SIGNING_KEY`.
