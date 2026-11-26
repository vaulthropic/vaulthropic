## Summary

<!-- What changed, and why. Link a related issue when there is one. -->

## CLA

The required status check is `Vaulthropic CLA`.

After you create this pull request, Overview may show the status "Required checks failing".

In this CLA summary, check the boxes under Boundary and secrets and/or Local checks. Copy this line and post it as a comment, with no other text:

`I have read and agree to the terms of CLA.md`

Case, extra spaces, and an optional trailing period are ignored. No other text is allowed.

Commenting alone does not automatically pass the check. Under "Required checks failing", click "Checks". The list drops down and shows "CLA / CLA acceptance (pull_request_target)". Click that link. On the next page, at the top right, click "Re-run jobs", then "Re-run failed jobs". Wait for the re-run to finish so the check passes.

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
