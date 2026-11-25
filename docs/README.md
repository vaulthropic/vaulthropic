# Documentation

These documents are the product and engineering specification for developers,
auditors, and users.

## Product and integration

| Document | Purpose |
| --- | --- |
| [USER-GUIDE.md](USER-GUIDE.md) | End-user setup, supported networks, session ceilings, and protocol use |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System boundaries, account model, and settlement flow |
| [EXECUTION.md](EXECUTION.md) | Attempt lifecycle, reservations, finality, and reason codes |
| [AUTH.md](AUTH.md) | Passkey, wallet, TOTP, OAuth, and API-key boundaries |
| [PROTOCOLS.md](PROTOCOLS.md) | x402, AP2, MPP, and MCP integration contracts |
| [ADAPTERS.md](ADAPTERS.md) | Chain and settlement adapter behavior |
| [API.md](API.md) | Public interfaces, stability levels, errors, and compatibility |
| [GLOSSARY.md](GLOSSARY.md) | Canonical product, policy, protocol, and settlement terms |

## Engineering and assurance

| Document | Purpose |
| --- | --- |
| [CONTRACTS.md](CONTRACTS.md) | Contract map, invariants, tests, and deployment publication |
| [THREAT-MODEL.md](THREAT-MODEL.md) | Assets, actors, boundaries, and residual risk |
| [REPOSITORY.md](REPOSITORY.md) | Repository layout, hooks, and CI |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Pointer to the root contributor workflow and security contact |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting and supported surface |
| [CHANGELOG.md](CHANGELOG.md) | Record of accepted changes |

## Brand

[BRAND.md](BRAND.md) defines the public visual system and voice.
The name, logo, and brand identity are reserved in [TRADEMARKS.md](../TRADEMARKS.md).

## Repository governance

| File | Purpose |
| --- | --- |
| [LICENSE](../LICENSE) | MIT license |
| [TRADEMARKS.md](../TRADEMARKS.md) | No right to the Vaulthropic name, logo, or brand |
| [CLA.md](../CLA.md) | Contributor license agreement |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Local setup, checks, secrets, and CLA acceptance |
| [ISSUE_TEMPLATE](../.github/ISSUE_TEMPLATE/config.yml) | Bug and feature forms. Blank issues stay closed. Security reports go to a GitHub Security Advisory |
| [PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) | Pull request checklist |
| [cla.yml](../.github/workflows/cla.yml) | CLA gate, skipped until `CLA_GATE_ENABLED` is `true` |

The console reading surface in `apps/web/src/docs/pages/` follows
[USER-GUIDE.md](USER-GUIDE.md): `guide.mdx` is the setup guide, `usdc-apis.mdx`
is the pay-per-call page, and `what-is-vaulthropic.mdx` is the plain-language
overview. Guide section hashes stay on `/docs#...`.

Each document is authoritative for its listed subject. Keep the root README to
the project overview and this index; link to `AUTH.md`, `EXECUTION.md`,
`PROTOCOLS.md`, or `ADAPTERS.md` instead of repeating their implementation
details. `USER-GUIDE.md` is the end-to-end setup path, and the app's `/docs`
surface is its separately maintained reading counterpart.
