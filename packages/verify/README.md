# @blackbox/verify

Offline verifier for [Blackbox Receipts](https://github.com/nickthelegend/blackbox-receipts) packs
(`blackbox-pack/v1`): one JSON file holding an agent session's signed, hash-linked tool-call receipts, the
proxy's public key, the signed seal and the `no-secrets-read` property proof.

```sh
npx ./blackbox-verify-0.1.0.tgz pack.json            # from the tarball, no clone needed
npx ./blackbox-verify-0.1.0.tgz pack.json --public-key proxy.pem   # also require this signer
```

It checks every receipt's Ed25519 signature and hash link, the seal (nothing cut off the end) and the
property proof under the pinned policy `no-secrets-read/v1`, and names the step that breaks. No network,
no private key. Exit code 0 PASS, 1 FAIL, 2 usage error or unreadable file. `--json` prints the full result.

The same checks as a library (`verifyPack`, `verifyChain`, `verifySeal`, `verifyPropertyProof`) run in
Node and in the browser; only the `blackbox-verify` bin uses Node APIs.

MIT, Copyright (c) 2026 Nivesh Gajengi.
