# Security policy

Vaulthropic policy contracts are non-custodial. A bug in `PolicyAnchor.charge` or `GuardAccount.executeAsSession` can still move a user's own funds if they installed the account. Report those bugs privately.

## Report

Email `security@vaulthropic.com` with:

- affected contract, package, or commit
- the failing case, preferably as a Foundry test or a Vitest
- impact on an account that has opted into the guard

Do not open a public GitHub issue, pull request, or discussion for an unfixed spend-bypass or other vulnerability. Do not include a live private key, mnemonic, or customer list in the report.

There is no bug-bounty schedule in this repository.

## Supported surface

- `contracts/src/**`
- `packages/core`, `packages/x402`, `packages/ap2`, `packages/mpp`, `packages/mcp-gate`, `packages/chain-adapter`
- the commit hooks and CI checks

The console demonstrates sign-in in the browser. A passkey, wallet proof, TOTP seed, or API token kept only in the browser is not a production identity deployment. An identity directory must not hold funds or signing keys.

## Disclosure

Please allow time to ship a fix and a regression test before public detail. A published audit report is added under `docs/audits/`. None are published in this scaffold.
