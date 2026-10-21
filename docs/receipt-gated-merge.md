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

In this repo the gate runs as `.github/workflows/attest-diff.yml` (pull requests) and the
`verify:attest-diff` job in `.gitlab-ci.yml` (merge requests; not run yet, as the GitLab project doesn't
exist). Both call `scripts/ci/attest-diff-pr.sh <base> [out-dir]`, which picks the exported session the
request adds at `receipts/<session>/session.jsonl` (deeper folders such as `receipts/agent-demo/` are not
a request's own session), prints NOT APPLICABLE and passes when there is none, fails when there are two,
and otherwise runs `attest-diff --from` it and prints the JUnit summary.

`bash scripts/demo-attest-diff.sh` shows all three outcomes on real branches in a temp clone of this repo
(agent change green, human commit on the agent's file red, file written around the proxy red); its
output from one run is in [`receipts/attest-diff-demo/`](../receipts/attest-diff-demo/).

For another repo, adapt the examples in [examples/ci/receipt-gated-merge.github.yml](../examples/ci/receipt-gated-merge.github.yml)
and [examples/ci/receipt-gated-merge.gitlab-ci.yml](../examples/ci/receipt-gated-merge.gitlab-ci.yml).

Limits: the gate proves where each changed byte came from, not that the change is good. It trusts the
proxy key (pin it). Renames show up as a delete plus an add, so a rename fails unless the new file was
written through `write_file` and the delete is accepted by hand. The attestation's signer is the CI
runner's key unless you provide one with `RECEIPTS_SIGNING_KEY`.
