# Architecture

Vaulthropic v1 is an **escrow-free anchor and guard** on Base, with a deterministic off-chain evaluator in front of x402, AP2, MPP, and MCP.

The user keeps the asset. A session key can spend only inside a policy the user's account committed. Vaulthropic cannot upgrade that policy under them, and the contracts cannot pull the balance.

## Rails

| Piece | Choice | Why |
| --- | --- | --- |
| Chain | Base `eip155:8453`, sandbox Base Sepolia `eip155:84532` | x402 `exact` and USDC EIP-3009 are already specified on these CAIP-2 ids |
| Asset | USDC, 6 decimals | Public, stable unit for machine payments. The anchor is parameterized by token address so tests use a mock |
| Account | `GuardAccount` plus `GuardAccountFactory` | Per-user account. Owner is immutable. Factory does not own the account |
| Policy | `PolicyAnchor` | One immutable contract, no admin, no token transfer |
| Richer rules | `@vaulthropic/core` | Endpoint, mandate, MCP, and API-key checks that do not fit in the EVM call |

Other CAIP-2 networks can appear in a policy document. `anchorDraft` accepts only the reference chain for that environment, so a sandbox policy cannot commit Base mainnet. Solana, other EVM chains, and MPP-native rails such as Tempo are adapter targets in `@vaulthropic/chain-adapter`. They share `evaluateSpend` and `AttemptLedger`. The v1 settlement bytecode stays the Base contracts, and the console selector stays Base and Base Sepolia. See [ADAPTERS.md](ADAPTERS.md) and [EXECUTION.md](EXECUTION.md).

## On-chain modules

`PolicyAnchor.commitPolicy` is callable only by the account (`msg.sender`). It stores:

- `policyHash`, the keccak256 of the canonical policy JSON
- session signer, asset, exclusive `validUntil`
- per-transaction cap, epoch cap, epoch length, step-up threshold
- a recipient allowlist of at most 64 addresses

`charge` is also called by the account. It reverts with a named error when the session is paused, revoked, or expired, the asset or recipient is outside the policy, the amount is above the per-transaction cap, the amount is greater than or equal to the step-up threshold, or the epoch budget would be exceeded. A new epoch zeroes `epochSpent`. The function updates a counter. It does not move tokens. It also does not reserve or release: a guarded transfer is accounted when it executes. The off-chain attempt ledger is what locks principal, quoted fee, and gas before broadcast.

`GuardAccount` has two execution paths:

- `execute` — owner. Does not charge the session budget. This is the sovereign exit, including while the session is paused.
- `executeAsSession` — session signer only. Each call must be an ERC-20 `transfer` of non-zero value and no native value. `approve` and every other selector revert. `charge` runs before the token call. A reentrant token hits the account lock.

Session revocation and pause are owner actions. Recommit replaces the recipient set and resets the epoch counter, which a session key cannot do because it cannot call `commitPolicy`.

There is no proxy and no rescue function. Ether sent to the anchor is rejected.

## Off-chain evaluator

`evaluateSpend` is a pure function. Empty allowlists fail closed. Sandbox and mainnet cannot share a request. Caps are integer strings in minor units. The same threshold rule as the contract applies: `amount >= stepUpAbove` is step-up, and a host may pass `stepUpSatisfied` only after it has verified the owner factor. Step-up does not raise the per-transaction or epoch cap.

Optional user ceilings (`maxFeeAmount`, `maxFeeBps`, `maxGasAmount`, `maxCombinedAmount`) cap a quoted fee or gas budget. The quote has to fit those ceilings and the epoch total. The evaluator checks the number. It does not compute it. When the host composes a protocol decision with `AttemptLedger.begin`, the ledger reserves that total before the host exposes a credential or signature request and follows the attempt through inclusion, finality, replacement, drop, and expiry. The protocol gate functions do not create the reservation themselves.

`tighten` can turn allow into step-up or block, and step-up into block. It cannot reverse a block or raise a ceiling.

Canonical JSON sorts object keys, drops `undefined`, and rejects floats. `policyHash` is `keccak256` of that document. The same bytes are checked in `contracts/test/fixtures/policy.canonical.json`.

## Two ways a payment actually settles

**Guarded transfer.** The session key calls `executeAsSession` and the token moves in that transaction. MPP's hash credential and a transaction receipt can cite that hash. This is the hard guarantee. A stolen session key still cannot pay a stranger or exceed the cap.

**x402 exact / EIP-3009.** USDC `transferWithAuthorization` recovers an externally owned signer. A smart-account address cannot satisfy that recovery, and the token does not call `PolicyAnchor`. `evaluateX402` returns the decision and omits the unsigned authorization. `releaseX402Authorization` returns that authorization and EIP-712 typed data only when the decision is `allow` and the same single-realm `AttemptLedger` holds the reservation. A block or step-up omits them. A host that shares the budget across processes does not get a payload from this in-memory ledger. The host wallet signs. Vaulthropic does not hold the key, and the contract cannot cancel a signature the user later produces outside the adapter. That limitation is deliberate and public.

## Request path

1. The agent runtime receives an x402 `PAYMENT-REQUIRED`, an MPP `WWW-Authenticate: Payment`, an AP2 mandate bundle, or an MCP `tools/call`, plus an idempotency key.
2. The matching protocol package normalizes the request and calls `evaluateSpend`, including any quoted fee and gas budget. These protocol gates do not automatically invoke `AttemptLedger`; the host composes the decision with the ledger for attempt-based settlement.
3. After allow, the host begins an attempt to reserve principal, fee, and gas before it exposes a signable payload, constructs a credential, or submits a guarded transfer. The current chain adapter's `acquireSequence` path invokes the ledger; the protocol gate functions do not. The reservation is committed at the configured settlement state and released if the attempt dies.
4. A step-up returns no payload and does not reserve. The host may retry with `stepUpSatisfied` only after it has verified the owner factor. The public console's passkey, wallet proof, and page-local TOTP check do not set that flag and do not authorize a payment.
5. Block returns a stable reason code and stops.
6. The anchor event `SpendCharged` is the on-chain audit line for guarded transfers. The policy hash links that line to the public JSON.

## Evaluator

The evaluator is the complete rule for allow, block, and step-up. It has no pricing, partner-routing, or risk-weight parameters. A host may call `tighten` after the decision only to make the outcome stricter. `tighten` cannot skip `charge` on the guarded rail, because the session key cannot move tokens any other way. The policy records the user's ceiling. A settled attempt records the amount that moved.

Operator RPC URLs and the deployer key are environment variables at broadcast time. They are not source.
