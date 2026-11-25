# User and developer guide

This guide is the setup path for Vaulthropic. It covers what the firewall guarantees, which networks v1 can settle, how to configure a session, and how x402, AP2, MPP, and MCP share one pre-sign decision.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the anchor-and-guard model, [EXECUTION.md](EXECUTION.md) for AttemptLedger, [AUTH.md](AUTH.md) for console identity, and [PROTOCOLS.md](PROTOCOLS.md) for adapter reason codes. The console has a separately maintained reading surface at `/docs`; keep its key behavior consistent with this guide.

This guide is the user reading bundle intended for documents.vaulthropic.com and is served at `/docs` until that host is attached. The page is a white reading surface with a left menu. The plain-language introduction, including the non-affiliation notice, is `/docs/what-is-vaulthropic`. Pay-per-call API setup is the additional page `/docs/usdc-apis`.

## Overview and non-custodial guarantees

Vaulthropic is a pre-execution financial firewall for agent payments. An agent presents a payment intent. The policy engine returns allow, step-up, or block before anyone signs an authorization or broadcasts a transfer.

The same decision covers four rails:

| Rail | What is gated |
| --- | --- |
| x402 | An HTTP 402 exact payment. The EIP-3009 payload is prepared only after allow. |
| AP2 (Agent Payments Protocol) | Intent, cart, and payment mandates. Amount, payee, time, and cart hash have to agree. |
| MPP (Machine Payments Protocol) | A payment challenge. A credential is built only after allow. |
| MCP (Model Context Protocol) | A tool call. Servers and tools outside the allowlist stop before spend arguments run. |

The non-custodial model has four boundaries:

- Vaulthropic does not hold pooled customer funds and does not hold a root private key or seed phrase.
- Spending is governed by a `GuardAccount` the user owns. The owner `execute` path does not charge the session budget. That is the sovereign exit. `executeAsSession` calls `PolicyAnchor.charge` before the token transfer.
- A session has scoped ceilings and a TTL (`session.validUntil`). The signer is a session key, not the owner's root key. Console sign-in, including a passkey, is a console identity. It grants no token allowance and no spending key.
- When a host composes a flow with `AttemptLedger`, it reserves principal + quoted fee + gas before broadcast and releases that reservation on drop, revert, failure, or expiry. One open serial attempt blocks the next one for that signer. The standalone protocol gates do not create ledger attempts; see [EXECUTION.md](EXECUTION.md).

A block returns a stable `BLOCK_*` reason and withholds the signable payload. A step-up (`STEP_UP_ABOVE_THRESHOLD`) also withholds it until the owner factor is verified. The host may then retry with `stepUpSatisfied`.

## Supported networks

### Active v1 settlement targets

v1 publishes two settlement targets. Both use USDC (6 decimals). Contract addresses in this repository are intentionally null until bytecode verification. A null address is not a live deployment.

| Network | CAIP-2 | Role | USDC |
| --- | --- | --- | --- |
| Base | `eip155:8453` | Mainnet settlement target | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | `eip155:84532` | Sandbox and integration target. Same contract semantics. No real funds. | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

`contracts/deployments/base.json` and `contracts/deployments/base-sepolia.json` record `status: "not-deployed"`. `policyAnchor` and `guardAccountFactory` stay null until a verified deployment is published. The policy engine still evaluates both environments. Sandbox and mainnet sessions cannot cross: a Base Sepolia credential presented to a Base policy is `BLOCK_SESSION_ENVIRONMENT`.

The reference contracts are `PolicyAnchor`, `SpendCall`, `GuardAccount`, and `GuardAccountFactory`. `GuardAccount` is not an ERC-4337 account and this repository does not ship a paymaster. The anchor accounts a guarded session transfer when it executes. It does not reserve, release, or price a fee. `AttemptLedger` does the pre-broadcast reservation.

### Chain-agnostic engine and adapters

The policy engine and `AttemptLedger` are chain-agnostic. A rail adapter normalizes its payload into the same spend request: chain, asset, recipient, amount, endpoint, quoted fee, and gas budget. Protocol gates return policy decisions; attempt reservation is a separate host-orchestration step unless the flow uses the chain adapter's `acquireSequence` path. The shared policy checks are:

- per-transaction cap, epoch budget, and step-up threshold
- fee ceiling (`maxFeeAmount`, `maxFeeBps`) and gas ceiling (`maxGasAmount`)
- combined ceiling (`maxCombinedAmount`) on principal + fee + gas
- allowlists for recipient, endpoint, asset, and chain
- idempotency key, serial in-flight queue, and replay of a settled challenge or mandate when the host uses `AttemptLedger`

`@vaulthropic/chain-adapter` is that boundary. The v1 network selector lists Base and Base Sepolia. Later rails are policy targets with the same ceilings and the same ledger. Details are in [ADAPTERS.md](ADAPTERS.md).

- v1 is Base (`eip155:8453`) and Base Sepolia (`eip155:84532`). The host seeds `setSignerNonce` before the first attempt. An unseeded signer is `BLOCK_NONCE_UNAVAILABLE`.
- Wave 2 is Arbitrum (`eip155:42161`) and Polygon (`eip155:137`). They reuse the EVM adapter. A gas quote above `maxCombinedAmount` is still `BLOCK_COMBINED_CEILING`.
- Wave 3 is Solana (`solana:mainnet`, `solana:devnet`), BSC (`eip155:56`), Ethereum (`eip155:1`), and the Tempo rail (`mpp:tempo`). Solana leases a recent blockhash. When that window passes, the ledger expires the attempt and releases the reservation. The adapter does not submit the transaction and does not hold a fee-payer key. Tempo maps one challenge id to one attempt. This repository publishes no token address for those later rails.

## Testnet USDC faucet

Start on Base Sepolia (`eip155:84532`), the v1 sandbox. [Circle’s public Testnet Faucet](https://faucet.circle.com/) sends testnet USDC to an address you paste. It does not ask for a Circle account. Circle’s page states the current limit: 20 testnet USDC per address, per network, every 2 hours.

When the test pays gas from that wallet, also claim a small amount of the testnet native token: ETH, POL, or SOL. Circle’s Developer Console faucet sends native testnet tokens to Circle Wallets. A wallet you control uses the gas faucets below. These testnets fund that wallet. The v1 environment control still lists Base and Base Sepolia. Arbitrum Sepolia (`eip155:421614`), Polygon Amoy (`eip155:80002`), and Ethereum Sepolia (`eip155:11155111`) are funding networks, distinct from the mainnet adapter ids.

| Network | Testnet USDC | Native gas and docs |
| --- | --- | --- |
| Base Sepolia (`eip155:84532`), v1 sandbox | Circle faucet, network **Base Sepolia** | [Circle Testnet Faucet](https://faucet.circle.com/) · [Base Get Funds](https://docs.base.org/get-started/get-funds) · [Chainlink Base Sepolia](https://faucets.chain.link/base-sepolia) |
| Arbitrum Sepolia (`eip155:421614`) | Circle faucet, network **Arbitrum Sepolia** | [Circle Testnet Faucet](https://faucet.circle.com/) · [Chainlink Arbitrum Sepolia](https://faucets.chain.link/arbitrum-sepolia) |
| Polygon Amoy (`eip155:80002`) | Circle faucet, network **Polygon PoS Amoy**. Gas token is POL | [Circle Testnet Faucet](https://faucet.circle.com/) · [Chainlink Polygon Amoy](https://faucets.chain.link/polygon-amoy) |
| Solana Devnet (`solana:devnet`) | Circle faucet, network **Solana Devnet** | [Circle Testnet Faucet](https://faucet.circle.com/) · [Solana Devnet Faucet](https://faucet.solana.com/). The Solana CLI can also request devnet SOL with `solana airdrop` and `--url devnet` |
| Ethereum Sepolia (`eip155:11155111`) | Circle faucet, network **Ethereum Sepolia**. If a testnet is missing from that list, Circle’s CCTP docs describe a testnet move from Ethereum Sepolia onto a supported testnet | [Circle Testnet Faucet](https://faucet.circle.com/) · [Circle CCTP](https://developers.circle.com/cctp) · [Chainlink faucets](https://faucets.chain.link/base-sepolia) |

### Funding checklist

1. Pick the exact testnet. A v1 session starts on Base Sepolia.
2. Claim testnet USDC from Circle’s faucet. Claim testnet ETH, POL, or SOL when that wallet pays gas.
3. Confirm the balance in the wallet you control. Run a small allow (`ALLOW_WITHIN_POLICY`) and a ceiling block (`BLOCK_*`) in the Decision Lab before raising test amounts.

Vaulthropic is not affiliated with Circle, the operators of Base, Chainlink, or the Solana Foundation. Testnet tokens have no real value.

## Session setup

Configure and verify on Base Sepolia before pointing a session at Base.

### Step 1 — Console identity and wallet ownership

1. Open Sign in.
2. The email or username field starts empty. **Create passkey** stays off until the name is valid. Click **Create passkey** to create a credential. WebAuthn runs on that click. Typing or leaving the field does not create a credential. The browser prompt shows only the typed name. WebAuthn does not confirm the inbox. The user id is a random handle. An email stays labeled **Unverified email**. A username has no email attached. **Sign in with passkey** is a separate button and stays off until that click. An empty field asserts a passkey already on the device. A typed email or username is an unverified label. This build stores the credential id for the page session and does not check the assertion signature or the sign counter. Neither button generates an EVM or Solana key. The passkey is a console identity, not a spending key.
3. Or choose **Sign in with wallet**. A picker lists detected EIP-6963 wallets (and a legacy injected wallet when the browser exposes one). Unsupported connectors stay disabled. Choosing a wallet asks for an account, then the page shows the exact sign-in message. **Sign this message** is the click that requests the signature. The page recovers the signer and checks the message, domain, chain id, and expiry before it shows the address. That address is a console proof. Guard owner and session signer stay unassigned. A deployed console must verify the signature again, and accept each nonce once, before it trusts the address. The signature grants zero token allowance.
4. OAuth stays disabled in this build. The control reads "Coming soon in a later release."
5. The signed-in console can enroll a page-local TOTP seed and issue a page-local API token. Both stay in the page. A matching code says the factor matched and that it did not authorize a payment. The token and its hash are not saved. A `vth_live_` prefix on this page is still that local token while the deployment files stay `not-deployed`.

The network selector on that screen is only Base (`eip155:8453`) and Base Sepolia (`eip155:84532`).

### Identity directory versus custody

A production console should have an identity directory of users and credentials, separate from settlement and from `GuardAccount` balances. It records an opaque user handle (the WebAuthn `user.id`), a display name, email verification status, a credential id, the COSE public key, and a sign counter. It must not hold balances, seed phrases, owner keys, or session private keys. It is not a custody ledger and not KYC.

`shortcut: the console keeps the credential id in page memory only; upgrade when an identity directory stores the credential id, COSE public key, and sign counter.`

### Step 2 — Network, ceilings, and allowlists

Pick the network, then set the session rules. The console field names map to the policy document as follows. Do not rename the schema fields.

| Console label | Policy field | Example sandbox value |
| --- | --- | --- |
| Epoch budget | `limits.perEpoch` | 100 USDC (`100000000` minor units) |
| Max per-transaction cap | `limits.perTransaction` | 25 USDC |
| Step-up approval threshold | `limits.stepUpAbove` | 10 USDC |
| Session TTL | `session.validUntil = now + ttlSeconds` | A whole number of seconds, from 1 through 366 days |
| Epoch window | `limits.epochSeconds` | 86400 (24 hours). This is the rolling budget window, separate from the session TTL. |
| Max fee amount | `limits.maxFeeAmount` | Omit to refuse any positive quoted fee |
| Max fee basis points | `limits.maxFeeBps` | Integer 0 through 10000. Both fee ceilings apply when both are set. |
| Max gas ceiling | `limits.maxGasAmount` | Omit to refuse any positive gas budget |
| Combined ceiling | `limits.maxCombinedAmount` | Principal + fee + gas. Cannot exceed the epoch budget. |

Rules the engine enforces when the policy is normalized:

- `0 < stepUpAbove <= perTransaction <= perEpoch`
- Epoch length is 60 seconds through 366 days.
- A quoted fee with neither fee ceiling set is `BLOCK_FEE_CEILING`.
- A gas budget with no `maxGasAmount` is `BLOCK_GAS_CEILING`.
- Principal + fee + gas above `maxCombinedAmount` is `BLOCK_COMBINED_CEILING`.
- Principal + fee + gas also counts against `perEpoch` (`BLOCK_EPOCH_CAP`).
- Direct policy evaluation returns `BLOCK_SESSION_EXPIRED` when `now >= session.validUntil`.
- An attempt deadline must satisfy `now < deadline <= session.validUntil`; otherwise `AttemptLedger.begin` returns `BLOCK_DEADLINE_EXCEEDED`. The ledger's deadline-first precedence for an expired session is described in [EXECUTION.md](EXECUTION.md).

Also set:

- Merchant and recipient addresses. An unknown recipient is `BLOCK_RECIPIENT_NOT_ALLOWLISTED`. The example sandbox recipient is `0x209693Bc6afc0C5328bA36FaF03C514EF312287C`.
- Allowed asset: USDC at the address for the selected network.
- Permitted protocols: x402, AP2, MPP, and MCP. MCP also has a server and tool allowlist. The example server is `https://mcp.example.com` with tools `search` and `quote`.
- Endpoint allowlist. The example prefix is `https://merchant.example`. A URL outside it is `BLOCK_ENDPOINT_NOT_ALLOWLISTED`.

The Decision Lab flags contradictory numbers before Evaluate:

- Step-up above the per-transaction cap. Step-up can never fire, because the hard block is reached first.
- Per-transaction cap above the epoch budget.
- `maxCombinedAmount` below principal + fee + gas.
- Session TTL of 0 seconds, or a recipient that is not allowlisted.

**Fix automatically** rewrites the conflicting field into a policy the normalizer can accept. Equal caps are valid: step-up may equal the per-transaction cap, and that cap may equal the epoch budget.

### Step 3 — Connect an agent and verify on Base Sepolia

Point the agent runtime at the sandbox session. Run a dry decision before any signature.

On Base Sepolia (`eip155:84532`), with the example ceilings (25 / 100 / 10 USDC) and the allowlisted recipient, confirm:

| Probe | Expected reason |
| --- | --- |
| 1 USDC, zero fee, zero gas | `ALLOW_WITHIN_POLICY` |
| 10 USDC | `STEP_UP_ABOVE_THRESHOLD` |
| 30 USDC | `BLOCK_PER_TX_CAP` |
| Positive fee, no fee ceiling | `BLOCK_FEE_CEILING` |
| Positive gas, no gas ceiling | `BLOCK_GAS_CEILING` |
| Principal + fee + gas above `maxCombinedAmount` | `BLOCK_COMBINED_CEILING` |
| Same challenge or mandate after `FINALIZED` | `BLOCK_REPLAY` |
| Second serial begin while one attempt is open | `BLOCK_ATTEMPT_IN_FLIGHT` |
| EVM signer with no seeded nonce | `BLOCK_NONCE_UNAVAILABLE` |
| Direct policy evaluation after session expiry | `BLOCK_SESSION_EXPIRED` |
| Attempt deadline already past, or later than the session expiry | `BLOCK_DEADLINE_EXCEEDED` |
| Recipient outside the allowlist | `BLOCK_RECIPIENT_NOT_ALLOWLISTED` |

The Decision Lab is its own screen and does not require sign-in. The Testnet tab runs the presets: the first three rows through the protocol adapter, and the replay preset through a new `AttemptLedger` in the page. The lab starts from the example policy. Ceiling edits stay in the page and are not an anchor commitment. Nothing is stored until **Save draft in this browser**. That saved draft is not a committed policy and not an anchor hash. **Load saved draft** is what copies it back into the form. The Testnet tab keeps Base Sepolia even if a saved draft names Base. The Mainnet tab can hold a live endpoint URL and a public payTo address in that screen only. It does not write the rehearsal draft, it has no credential field, and it does not sign or broadcast. `contracts/deployments/base.json` stays not-deployed, with `policyAnchor` and `guardAccountFactory` null, so live settlement stays unavailable. The console card labeled example policy hash is the example policy, not the lab draft. There is no user dashboard until an owner commits a policy hash to a guard account they control. AP2 in the lab uses a presence check, not SD-JWT verification, and its intent fixture is 100 USDC. The replay hash is synthetic, and that ledger is discarded with the result. Nothing is signed or broadcast.

Promote the same ceilings to Base (`eip155:8453`) only after those sandbox results match. Promotion changes the session environment. It does not attach a mainnet deployment by itself. Settlement on Base waits until this repository publishes bytecode-verified `PolicyAnchor` and `GuardAccountFactory` addresses.

## Protocol integration

Every rail follows one loop. Names below are the real `AttemptLedger` statuses. There is no `INIT` or `RELEASED` status. A reservation is held on `CREATED`. A release is `DROPPED`, `REVERTED`, `EXPIRED_OR_DROPPED`, or `FAILED`.

```text
Agent            Vaulthropic           AttemptLedger              Chain
  |  intent           |                      |                       |
  |------------------>| normalize + evaluate |                       |
  |                   |--------------------->| begin                 |
  |                   |                      | CREATED               |
  |                   |                      | reserve principal+fee+gas
  |                   |                      | assign eip155 nonce   |
  |  allow / step-up / block                 |                       |
  |<------------------|                      |                       |
  | sign after allow; x402 releases the payload first |
  |------------------------------------------ broadcast ------------>|
  |                   | observe              | IN_FLIGHT_PENDING     |
  |                   | observe              | INCLUDED_UNFINALIZED  |
  |                   |    fast tier commits here                     |
  |                   | observe              | FINALIZED (terminal)  |
  |                   |    irreversible tier commits here             |
  |                   | or DROPPED / REVERTED / EXPIRED_OR_DROPPED / FAILED
  |                   |                      | release reservation   |
```

`INCLUDED_UNFINALIZED` commits the budget for `finality: "fast"`. `finality: "irreversible"` keeps the reservation until `FINALIZED`. A reorg observation of `REVERTED` or `DROPPED` after inclusion gives the budget back. `expireDue` moves a pre-inclusion attempt to `EXPIRED_OR_DROPPED` when `now` reaches the deadline or the Solana blockhash expiry, and the reason becomes `BLOCK_DEADLINE_EXCEEDED`.

An idempotency key that already has an open or settled attempt returns that attempt with `replay: true` and the message "This idempotency key already has an attempt." That path does not reserve again. `BLOCK_REPLAY` is the separate check: the challenge, mandate, transaction reference, or receipt was already consumed by a settlement.

### x402

Evaluate the HTTP 402 requirement before building an authorization.

```json
{
  "x402Version": 2,
  "resource": { "url": "https://merchant.example/quote" },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "1000000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    "maxTimeoutSeconds": 60,
    "extra": { "name": "USDC", "version": "2" }
  }]
}
```

Pass `quotedFeeAmount` and `maxGasFee` in minor units beside the requirement. The decision omits the EIP-3009 authorization. `releaseX402Authorization` returns the unsigned payload only after `AttemptLedger.begin` reserves that attempt in the same ledger, and only when the reservation matches the requirement. A second ledger returns no payload. `processes` other than 1 throws until one serializable store reserves the budget. Block and step-up omit the payload. This repository does not claim that the USDC contract itself enforces EIP-3009. The firewall enforces the policy by withholding the unsigned payload.

Third-party hosts that sell one HTTP call for USDC are on the console page `/docs/usdc-apis`. That page calls them x402 pay-per-call APIs, HTTP 402 metered endpoints, or agentic USDC payment endpoints. It walks the unpaid call, the 402 challenge, the policy decision, and the signed retry, and it compares that path with an API key or a subscription. Rehearse the example allowlist in the Decision Lab with `https://merchant.example` before a live host is added. The endpoint prefix and the receiving `payTo` come from the provider’s current documentation or from the 402 challenge on the call about to be sent. A copied address is not an allowlist entry. A listing cannot add itself. The page covers Brave Search, TwitterAPI.io, CoinGecko, and Massive, and it says how to check RunAPI and PayAPI Market. The v1 selector remains Base and Base Sepolia.

### AP2

Evaluate intent, cart, and payment mandates together. The cart amount matches the payment principal. The payment's `cartHash` is the cart commitment. For the example policy, a payment plus its quoted fee and gas must stay inside the intent amount. The example lab intent is 100 USDC so the ceiling probes fit. A mismatch returns `BLOCK_MANDATE_AMOUNT`, `BLOCK_CART_MISMATCH`, `BLOCK_MANDATE_PAYEE`, `BLOCK_MANDATE_SIGNATURE`, or `BLOCK_MANDATE_EXPIRED` before the spend ceilings run.

### MPP

Parse the `WWW-Authenticate: Payment` challenge, then evaluate it with the session policy, chain, endpoint, quoted fee, and gas budget. Allow is the only outcome that may proceed to `buildMppCredential`. The receipt later binds the transaction hash. A settled challenge presented again is `BLOCK_REPLAY`.

### MCP

Gate the tool call before the tool runs. The example allowlist accepts `quote` and `search` on `https://mcp.example.com`. Spend arguments use `amount` (or `value`), `payTo` (or `recipient`), and `url`. Optional `quotedFeeAmount` / `feeAmount` and `maxGasFee` / `gasBudget` join the same ceiling checks. Any other server is `BLOCK_MCP_SERVER_NOT_ALLOWLISTED`. Any other tool is `BLOCK_MCP_TOOL_NOT_ALLOWLISTED`. In the Decision Lab the server stays `https://mcp.example.com` and the tool stays `quote`. Changing the endpoint field checks that URL against the endpoint allowlist. It does not add a server or a tool.

## Reason codes used while verifying

Allow: `ALLOW_WITHIN_POLICY`, `ALLOW_STEP_UP`.

Caps and ceilings: `BLOCK_PER_TX_CAP`, `BLOCK_EPOCH_CAP`, `BLOCK_FEE_CEILING`, `BLOCK_GAS_CEILING`, `BLOCK_COMBINED_CEILING`, `STEP_UP_ABOVE_THRESHOLD`.

Session and allowlists: `BLOCK_SESSION_EXPIRED`, `BLOCK_SESSION_ENVIRONMENT`, `BLOCK_PAUSED`, `BLOCK_RECIPIENT_NOT_ALLOWLISTED`, `BLOCK_ENDPOINT_NOT_ALLOWLISTED`, `BLOCK_ASSET_NOT_ALLOWLISTED`, `BLOCK_CHAIN_NOT_ALLOWLISTED`.

Ledger: `BLOCK_REPLAY`, `BLOCK_ATTEMPT_IN_FLIGHT`, `BLOCK_NONCE_UNAVAILABLE`, `BLOCK_DEADLINE_EXCEEDED`.

The full catalog is `REASON_CODES` in `@vaulthropic/core`. Codes are `ALLOW_*`, `STEP_UP_*`, and `BLOCK_*`. The outcome beside a code is `allow`, `step_up`, or `block`.

## What this guide does not claim

- No mainnet or testnet deployment is live in this repository. Publish addresses only after bytecode verification.
- A fee or gas figure is an input. The policy checks it against the user's ceiling. The evaluator does not compute a rate card, a take rate, or a quote.
- Console sign-in is not custody, not KYC, and not a money-transmission flow.
- Solana, Arbitrum, Polygon, BSC, Ethereum, and Tempo are adapter targets in `@vaulthropic/chain-adapter`. The v1 selector lists Base and Base Sepolia. Bytecode in this repository is the Base contracts, and those deployment files stay `not-deployed`.
