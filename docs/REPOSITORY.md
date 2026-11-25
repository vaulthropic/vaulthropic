# Repository

The contracts, adapters, console, and these documents are the system a contributor builds and reviews. After bytecode verification, published addresses in `contracts/deployments/` can be compared to this source.

## Layout

```text
LICENSE             MIT license
TRADEMARKS.md       Name, logo, and brand are not licensed with the code
CLA.md              Contributor license agreement
CONTRIBUTING.md     Local setup, checks, secrets, and CLA acceptance
signatures/cla.json Log of exact CLA acceptance comments
foundry.toml        Foundry project at the repo root, sources under contracts/
contracts/          PolicyAnchor, GuardAccount, factory, Foundry tests, deploy script
packages/core/      Policy hash, evaluator, attempt ledger, reason codes, passkey, TOTP, API keys
packages/x402/      x402 v2 header gate
packages/ap2/       Intent, cart, and payment mandate gate
packages/mpp/       MPP challenge, credential, and receipt gate
packages/mcp-gate/  MCP tool gate
packages/chain-adapter/  AttemptLedger boundary for Base, later EVM chains, Solana, and MPP rails
apps/web/           Console and decision lab
brand/              Harbor / Verdigris tokens and the gate mark
docs/               Product, API, security, and assurance documents
.githooks/          Commit and push checks
.github/workflows/  CI for lint, tests, secret scan, and forge
.github/workflows/cla.yml  CLA comment gate, skipped until CLA_GATE_ENABLED=true
.github/PULL_REQUEST_TEMPLATE.md  Checklist for secrets, checks, and CLA.md
```

`docs/README.md` is the index. Do not add a second documentation root.

## Checks

Install the hooks once per clone:

```bash
bash scripts/install-git-hooks.sh
```

That sets `core.hooksPath` to `.githooks`.

| When | What runs |
| --- | --- |
| `git commit` | The checks in `.githooks/pre-commit` |
| `git push` | The checks in `.githooks/pre-push` |
| Pull request and push CI | The jobs in `.github/workflows/ci.yml`: secret scan, ESLint, `tsc`, Vitest, the console build, `forge fmt --check`, and `forge test` |

`.pre-commit-config.yaml` exposes the same Node checks for people who use the pre-commit framework.

Install forge-std with `forge install foundry-rs/forge-std --no-git` before the first contract test. Publish addresses, after bytecode verification, in `contracts/deployments/`.
