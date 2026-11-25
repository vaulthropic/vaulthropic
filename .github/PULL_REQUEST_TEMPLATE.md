## Summary

<!-- What changed, and why. Link a related issue when there is one. -->

## CLA

The required status check is `Vaulthropic CLA`. After you open this pull request, add a comment that contains only this sentence:

`I have read and agree to the terms of CLA.md`

The recommended comment has no trailing period. One trailing period is also accepted. Letter case and extra spaces do not matter. Any other text in that comment does not count. Posting the comment re-runs `.github/workflows/cla.yml` and updates the `Vaulthropic CLA` status. `dependabot[bot]` is allowlisted and does not comment. The agreement is https://github.com/vaulthropic/vaulthropic/blob/main/CLA.md.

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
