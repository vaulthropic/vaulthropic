## Summary

<!-- What changed, and why. Link a related issue when there is one. -->

## CLA

The required status check is `Vaulthropic CLA`. Check the boxes in this template, then post a **new** pull request comment that contains only this sentence:

`I have read and agree to the terms of CLA.md`

Case, extra spaces, and an optional trailing period are ignored. No other text is allowed. Editing an old comment does not trigger a new check. Post a new comment.

Posting the comment does not always turn `Vaulthropic CLA` green. If the check still fails or stays red after the boxes are checked and the new comment is posted:

1. Click the failed check in the status bar above, or **Details** next to **CLA / CLA acceptance**. You can also open the **Checks** tab.
2. Open the job menu and click **Re-run failed jobs**.
3. Wait for the re-run to finish so the check passes.

`dependabot[bot]` is allowlisted and does not comment. The agreement is https://github.com/vaulthropic/vaulthropic/blob/main/CLA.md.

The workflow stays skipped until the repository variable `CLA_GATE_ENABLED` is `true`.

## Boundary and secrets

- [ ] No secrets, private keys, seed phrases, `.env` values, tokenized RPC URLs, keystores, local databases, or unverified `payTo` or contract addresses.
- [ ] `pnpm check:boundary` passes.
- [ ] `pnpm check:secrets` passes.

## Local checks

SDK, console, and lint:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Contracts, when this pull request changes them:

```bash
forge test
forge fmt --check
```

`pnpm test:contracts` runs `forge test`.

- [ ] The change is focused and stays inside the scope in CONTRIBUTING.md.
- [ ] I license this contribution under LICENSE.
