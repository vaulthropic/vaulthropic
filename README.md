# Vaulthropic

Non-custodial on-chain guardrails for autonomous agent payments. This repository contains the smart contracts, protocol adapters, schemas, and the console.

**On-chain guardrails for autonomous agent payments.**

Vaulthropic is a non-custodial pre-execution firewall for autonomous agent payments. It sits in front of `x402`, `AP2`, `MPP`, and `MCP`. It decides allow, block, or step-up before the host receives an unsigned EIP-3009 authorization, a guard account transfers USDC, or an MCP tool runs. Funds stay in an account the user owns. The contracts have no protocol admin and no function that sweeps tokens.

v1 settlement is **Base** (`eip155:8453`) and **Base Sepolia** (`eip155:84532`), asset **USDC**. The selector lists only those two. The policy engine and `AttemptLedger` are chain-agnostic. `@vaulthropic/chain-adapter` carries the same core to later EVM chains, Solana, and MPP rails without broadcasting by default and without holding a key. Contracts in this repository are not deployed. This repository does not claim a live deployment.

## Documentation

Product and engineering Markdown lives in [`docs/`](docs/README.md). [docs/REPOSITORY.md](docs/REPOSITORY.md) maps the repository layout.

The user guide is intended for `documents.vaulthropic.com`; do not claim that host is deployed. The Markdown guide is [docs/USER-GUIDE.md](docs/USER-GUIDE.md). The console's `/docs` reading surface is implemented separately in [DocsPage.tsx](apps/web/src/DocsPage.tsx) and should be kept consistent with the guide.

The index links the [architecture](docs/ARCHITECTURE.md), [execution](docs/EXECUTION.md), [auth](docs/AUTH.md), [adapters](docs/ADAPTERS.md), and [threat model](docs/THREAT-MODEL.md).

Design is Harbor / Verdigris with vivid green, yellow, red, blue, and magenta accents. See [docs/BRAND.md](docs/BRAND.md). The console is professional, readable, and uses solid fills with accessible contrast. The header is a fixed 60px bar, flush to the viewport edges on the landing page and the guide. The landing page fits one viewport. The Decision Lab is its own screen: Testnet rehearses the example policy, and Mainnet holds a live endpoint and public payTo in that screen only.

## Sign-in

Console sign-in is separate from custody and grants no token allowance. The console supports passkey, wallet, and TOTP flows. OAuth stays disabled until a host injects an HTTPS authorization URL. See [docs/AUTH.md](docs/AUTH.md) for identity, credential, and API-key behavior.

## Develop

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm dev
bash scripts/install-git-hooks.sh
```

Contracts use Foundry:

```bash
forge install foundry-rs/forge-std --no-git
pnpm test:contracts
```

Copy `.env.example` to `.env` only on the operator machine. `contracts/script/Deploy.s.sol` reads `DEPLOYER_PRIVATE_KEY` from the environment when you choose to broadcast. This repo does not claim a live deployment; see `contracts/deployments/`.

## Status of enforcement

The reference account enforces policy **on-chain** for session ERC-20 transfers. x402 EIP-3009 is gated before the host receives signable data; it is not checked inside USDC. The host supplies any signer, and this repository never accepts a private key. See [ARCHITECTURE.md](docs/ARCHITECTURE.md) and [PROTOCOLS.md](docs/PROTOCOLS.md) for the enforcement boundaries.

Vaulthropic is policy software. It is not a bank, custodian, or money transmitter.

Vaulthropic is not affiliated with the operators of Base, Circle, or the authors of x402, AP2, MPP, or MCP.

## License and trademarks

The software license is the MIT license in [LICENSE](LICENSE), including its "AS IS" warranty and liability terms. [TRADEMARKS.md](TRADEMARKS.md) states that this license grants no right to the Vaulthropic name, logo, or brand identity. Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md) and [CLA.md](CLA.md).

Third-party components, including forge-std, keep their own licenses.
