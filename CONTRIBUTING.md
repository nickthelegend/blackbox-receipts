# Contributing to Blackbox Receipts

Thanks for helping. Blackbox Receipts is MIT licensed (`Copyright (c) 2026 Nivesh Gajengi`, see [LICENSE](LICENSE)),
and every contribution is accepted under that license.

## Sign off every commit (DCO 1.1)

This project uses the Developer Certificate of Origin 1.1, the same sign-off GitLab uses for contributions.
By adding a `Signed-off-by` line to a commit, you certify the statement below for that commit.

Sign off with `git commit -s`, which appends a line built from your `user.name` and `user.email`:

```
Signed-off-by: Your Name <you@example.com>
```

- Every commit in a merge request or pull request needs its own `Signed-off-by` line. Use a real name and an
  email address you can be reached at.
- Forgot one? `git commit --amend -s` fixes the last commit, and `git rebase --signoff <base>` fixes a whole branch
  before it is merged.
- Sign-off certifies where the change came from. It does not replace review, and it is not a CLA.
- Commits made before this file was added (2026-10-22) predate the policy and carry no sign-off.

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## Before you open a merge request

```sh
pnpm install && pnpm build
pnpm test && pnpm typecheck && pnpm lint
pnpm build:pages -- --base-path /blackbox-receipts && pnpm test:e2e   # browser E2E in Google Chrome
```

- One logical change per commit, with a message that describes only that commit's diff.
- No mocks of external APIs and no fake success. A missing key or runtime is reported as `Setup required`, and live
  tests skip loudly.
- Never commit keys, `.env` files or signing keys. Tests use throwaway `BLACKBOX_KEY_DIR`s.
- Receipts and exports under `receipts/` come from real runs only. Don't hand-edit them.
- A change to `packages/verify` must re-pack `release/blackbox-verify-0.1.0.tgz`
  (`pnpm pack --pack-destination ../../release` in `packages/verify`); `test/verify-bin.test.ts` checks it.
- An agent's change should carry its exported session under `receipts/<session>/`: the `attest-diff` job then
  checks that every other changed file came from a signed `write_file` step.
