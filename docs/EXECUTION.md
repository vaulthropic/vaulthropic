# Execution loop

An agent payment is an attempt. Broadcast is not settlement. `AttemptLedger` in `@vaulthropic/core` can reserve and track an attempt before broadcast. The protocol evaluators (`evaluateX402`, `evaluateAp2`, `evaluateMpp`, and `gateMcpToolCall`) return policy decisions; they do not automatically create ledger attempts. The host must compose an allow decision with `AttemptLedger.begin` before exposing a signable authorization or credential, or executing a paid tool. The chain adapter's `acquireSequence` path calls `begin` for flows that use that adapter. `PolicyAnchor.charge` remains the on-chain backstop for a session ERC-20 transfer. The anchor accounts that transfer when it executes. It does not reserve, release, or price a fee.

`shortcut: one JavaScript realm is the atomic reservation boundary; upgrade to a shared serializable store before running more than one host process.`

## Loop

1. Receive the payment intent and an idempotency key.
2. Run the protocol gate to validate its request and obtain a policy decision. The gate does not reserve budget and does not return an EIP-3009 payload.
3. Give the same policy inputs and idempotency key to `AttemptLedger.begin`. It returns an existing attempt for a duplicate key, or evaluates and reserves principal plus quoted fee and gas. It also assigns the next nonce for an `eip155:` signer.
4. For x402, call `releaseX402Authorization` with that same ledger. It returns the unsigned EIP-3009 payload only when the reservation is `CREATED`, protocol `x402`, outcome `allow`, and the policy hash, chain, principal, quoted fee, gas, asset, and recipient match. A different ledger returns `BLOCK_MALFORMED_REQUEST` and no payload. A later release of that reservation returns the same 32-byte payload nonce. `processes` other than 1 throws until one serializable store reserves the shared budget. Then sign and broadcast, and mark `IN_FLIGHT_PENDING` with the transaction hash or signature.
5. Watch confirmation and expiry. Finality converts the reservation to the settled amount. A drop, revert, failure, or expiry releases it.
6. The next attempt for that signer waits until step 5 resolves, unless the intent selects `queue: "async"`.

A step-up does not reserve. The host retries with `stepUpSatisfied` only after the owner factor is verified.

`evaluateSpend` returns `BLOCK_SESSION_EXPIRED` when `now >= session.validUntil`. `AttemptLedger.begin` validates its attempt deadline before invoking that evaluator. Consequently, an expired session submitted through the ledger can return `BLOCK_DEADLINE_EXCEEDED`, while direct evaluation returns `BLOCK_SESSION_EXPIRED`. This is a known reason-precedence mismatch; do not infer the direct evaluator's reason from a ledger result.

## Idempotency

`deriveIdempotencyKey` hashes `agentId`, `sessionId`, `protocol`, and `requestIntentId` with the same canonical JSON as the policy hash. A caller may pass an explicit key instead. A timeout after the attempt exists returns that attempt. A released attempt (dropped, reverted, expired, or failed) may be retried with the same key. The retry increments `attemptCount` and reserves once. `FINALIZED` never reserves again.

## Budget

The reservation is principal + quoted fee + max gas, in asset minor units. Concurrent attempts see committed spend plus outstanding reservations. The committed figure is the larger of the host's chain epoch spend and the settlements this ledger has already recorded. Confirming an attempt moves the reservation to the actual settled total, so unused gas comes back. A revert after a fast inclusion puts that amount back.

Passing a chain spend that already includes an in-flight transfer, while the reservation is still open, makes the next check stricter until `observe` catches up.

## Status

`AttemptModel` in the contracts tree names the same statuses the ledger uses.

| Status | Budget | Next attempt in serial mode |
| --- | --- | --- |
| `CREATED` | Reserved | Waits |
| `IN_FLIGHT_PENDING` | Reserved | Waits |
| `REPLACED` | Reserved. The new hash replaces the old one. The nonce stays. | Waits |
| `INCLUDED_UNFINALIZED` | Fast tier: settled, and the next attempt may start. Irreversible tier: still reserved. | Waits only for the irreversible tier |
| `FINALIZED` | Settled at the actual amount. Terminal. | May start |
| `DROPPED`, `REVERTED`, `EXPIRED_OR_DROPPED`, `FAILED` | Released | May start. The same key may retry |

`expireDue` moves a pre-inclusion attempt to `EXPIRED_OR_DROPPED` when `now` reaches its deadline or its blockhash expiry. An included attempt stays up for a later `FINALIZED`, `REVERTED`, or `DROPPED` observation. `FINALIZED` has no exit. Treat it as irreversible, which is why high-value intents use the `irreversible` tier and wait for that status.

Low-value intents may use `fast` and continue once the attempt is included. Finalization is still recorded when it arrives. A reorg observation of `REVERTED` or `DROPPED` from `INCLUDED_UNFINALIZED` restores the budget.

## Nonce and Solana blockhash

An `eip155:` signer needs `setSignerNonce` before the first attempt. The ledger assigns the next nonce inside the same call that reserves. Serial mode rewinds that nonce when the attempt is released and no later nonce is outstanding. Async mode can leave a gap when an earlier nonce dies after a later one was assigned. `nonceReusable` reports which case happened.

A `solana:` attempt requires `blockhashExpiresAt` inside the deadline. Silence after that window is expiry, not a pending mempool entry. The ledger does not submit the transaction and does not hold a fee-payer key.

## Replay

On settlement the ledger consumes the attempt's `challengeId`, `mandateId`, transaction reference, and `receiptId`. A later intent that presents a consumed challenge or mandate is `BLOCK_REPLAY`. A retry after a release may use the same challenge, because a dropped attempt is not settled. A reverted transaction reference stays consumed so that hash cannot be presented as a success.

## Fee ceiling and gas ceiling

The policy stores the user's ceilings only:

| Field | Meaning when set |
| --- | --- |
| `limits.maxFeeAmount` | Maximum platform fee in asset minor units |
| `limits.maxFeeBps` | Maximum platform fee in basis points of the principal. `10000` is 100% |
| `limits.maxGasAmount` | Maximum sponsored gas reimbursement in asset minor units |
| `limits.maxCombinedAmount` | Maximum principal + quoted fee + gas on one attempt. Cannot exceed the epoch cap |

A quoted fee above either fee ceiling, or any quoted fee when the session set neither ceiling, is `BLOCK_FEE_CEILING`. A gas budget above `maxGasAmount`, or any gas budget when that ceiling is absent, is `BLOCK_GAS_CEILING`. Principal + fee + gas above `maxCombinedAmount` is `BLOCK_COMBINED_CEILING`. The same total is what the epoch cap sees, so a fee or a gas budget cannot sit outside the rolling budget.

These fields are absent on the example policy, so its hash is unchanged. Adding a ceiling changes the policy hash. The reference anchor still enforces principal caps, recipient, asset, pause, expiry, and step-up. It does not interpret the ceiling fields. The hash binds them into the committed document. The ledger enforces them before a credential or a signature is produced.

x402 evaluates `quotedFeeAmount` and `maxGasFee` before `AttemptLedger.begin` can reserve the attempt. The EIP-3009 payload stays withheld until `releaseX402Authorization` reads that reservation. MPP evaluates the same ceilings before `buildMppCredential` will accept the decision. AP2 requires the payment principal plus the quoted fee plus gas to stay inside the intent amount. The cart still binds the merchandise principal. MCP forwards `quotedFeeAmount` / `feeAmount` and `maxGasFee` / `gasBudget` from tool arguments into the same check.

The host passes `quotedFeeAmount` and the gas budget in. The evaluator checks those numbers against the user's ceilings. It does not compute a rate table, a tier threshold, or a take rate.

## Sponsored gas, without custody

The ledger's gas budget is the policy gate for both sponsorship patterns below. Neither pattern puts user funds in a Vaulthropic account.

**EVM session.** The reference `GuardAccount` is not an ERC-4337 account and this repository does not deploy a paymaster. A future paymaster adapter has to do these steps in order: this ledger allows the attempt, including the combined spend and gas ceiling; an off-chain signer authorizes `paymasterAndData` with a short expiry; the EntryPoint runs the call; stablecoin reimbursement of gas stays inside the reserved gas budget. Sponsorship TTL, gas limit, and rate limit fail closed. `shortcut: paymaster bytecode is unspecified; upgrade when an audited ERC-4337 adapter is in scope.`

**Solana and other non-EVM rails.** A facilitator or fee-payer may submit the transaction and pay the base fee while the payment authorization moves stablecoins. The ledger records the reimbursement ceiling as `maxGasFee`. The facilitator settles that reimbursement under the same attempt. Vaulthropic does not custody the stablecoin balance and does not hold the user's signing key.

## Chains

The policy engine is chain-agnostic. Adapters own the rail.

| Rail | Where it lives in this repository |
| --- | --- |
| Base and Base Sepolia | v1 rows in `@vaulthropic/chain-adapter`. Reference `PolicyAnchor` and `GuardAccount`. `anchorDraft` accepts only that environment's reference chain. Deployment files stay `not-deployed` |
| Arbitrum (`eip155:42161`) and Polygon (`eip155:137`) | Wave 2. The same EVM adapter and the same ceiling checks. A policy may name the chain. The v1 selector stays on Base |
| BSC (`eip155:56`) and Ethereum (`eip155:1`) | Wave 3. The same EVM adapter. Finality defaults to irreversible. The catalog names the chain and symbol and does not publish a token address |
| Solana (`solana:mainnet`, `solana:devnet`) | Wave 3. Blockhash lease, expiry, and SPL-sized minor units. No Solana program and no fee-payer key |
| Tempo (`mpp:tempo`) or another MPP rail | Wave 3. Challenge idempotency on the same ledger. Credential construction stays in `@vaulthropic/mpp`. No Tempo deployment |

Adding a rail means a catalog row and, when the rail is a settlement chain, its own account or facilitator. It does not mean rewriting `evaluateSpend`. The adapter boundary is [ADAPTERS.md](ADAPTERS.md).
