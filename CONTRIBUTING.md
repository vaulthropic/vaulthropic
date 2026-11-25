# Contributing to Vaulthropic

This document is the practical process for contributing. Pull requests are how changes land.

## Scope

Vaulthropic accepts contributions to the policy anchor, the guard account, the public evaluator, the protocol adapters, the console, and the public docs.

Commercial pricing, partner lists, risk weights, private RPC URLs, and operator tooling do not belong here.

## Run the console and the docs

The console and the `/docs` guide are the Vite app in `apps/web`.

```bash
pnpm install
pnpm dev
```

The dev server listens on port 5173. Open `http://localhost:5173` for the console and `http://localhost:5173/docs` for the guide. If that port is already taken, start the app from `apps/web`:

```bash
pnpm exec vite --port 5178 --host 127.0.0.1
```

Copy `.env.example` to `.env` only on an operator machine, and only when you intend to run a local deploy script. Do not commit `.env`.

Install the local gates once per clone:

```bash
bash scripts/install-git-hooks.sh
```

Install forge-std locally:

```bash
forge install foundry-rs/forge-std --no-git
```

## Checks before a pull request

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm check:boundary
pnpm check:secrets
```

`pnpm test` covers the Vitest suites and `node --test scripts/*.test.mjs`.

For contract changes, also run:

```bash
pnpm test:contracts
forge fmt --check
```

`forge fmt --check` is part of contract CI. A console change that affects what a reader sees should be exercised in the browser.

## License and contributions

By submitting a contribution, you agree to license your changes under the repository [LICENSE](LICENSE) and [CLA.md](CLA.md) unless you state otherwise. You confirm that you have the right to submit the code under those terms. Contributions are voluntary and are made without expectation of compensation.

Comment this exact sentence on the pull request, with no other text:

`I have read and agree to the terms of CLA.md.`

`.github/workflows/cla.yml` stays skipped until the repository variable `CLA_GATE_ENABLED` is `true`. When that gate is enabled, it checks out the default branch, reads pull-request comments, and accepts that sentence from the pull request author. A match is recorded in `signatures/cla.json`. `dependabot[bot]` is allowlisted and does not comment. The workflow does not run code from the pull request.

## Secrets, payTo, and contract addresses

Do not commit secrets, private keys, seed phrases, `.env` values, tokenized RPC URLs, keystores, or local databases. If a real secret was committed, rotate it. Deleting the line does not revoke it.

`contracts/deployments/base.json` and `contracts/deployments/base-sepolia.json` stay `not-deployed` until bytecode verification. `policyAnchor` and `guardAccountFactory` stay `null` until then.

The USDC addresses in those files and in `packages/core/src/chains.ts` are Circle's published token contracts. Do not replace them with an unverified address.

`examplePolicy` and its canonical hash are fixtures. Change them only when the fixtures, tests, and docs are updated together.

Decision Lab mainnet fields take a live endpoint and a public `payTo` at runtime. Do not hardcode either into the rehearsal draft.

Deployment scripts read `DEPLOYER_PRIVATE_KEY` from the environment. Foundry tests use `makeAddr` and `vm.prank`. Do not put a test private key in a source file.

## Security reports

Do not open a public GitHub issue, pull request, or discussion for a suspected vulnerability. Report it privately to `security@vaulthropic.com`, as described in [docs/SECURITY.md](docs/SECURITY.md).

## What belongs in the change

Keep the evaluator deterministic. Do not add a hidden commercial heuristic. `tighten` may only make a decision stricter.

New session behavior needs a Foundry test that shows the token balance and `epochSpent` after both the success and the revert.

Use the Harbor and Verdigris tokens in `brand/colors.css`. Do not add a warm-coral palette or a serif wordmark. The console wordmark is title case. If you change the mark, update `brand/logo.svg` and `apps/web/public/mark.svg` together. Brand rules are in [docs/BRAND.md](docs/BRAND.md). The name, logo, and brand identity are reserved in [TRADEMARKS.md](TRADEMARKS.md).
