# Chain and rail adapters

`@vaulthropic/chain-adapter` is the boundary between the firewall core and a settlement rail. Base, Base Sepolia, later EVM chains, Solana, and MPP credential rails use the same `evaluateSpend` and `AttemptLedger` when a host runs them through this adapter. The standalone protocol gates return decisions and do not automatically create ledger attempts.

The adapter does not custody funds, hold a signing key, or open an RPC connection. A host that wants a broadcast injects `broadcast`. A host that wants inclusion injects `readInclusion`. With neither transport, `submitAttempt` accepts a transaction hash or Solana signature that the host already broadcast.

v1 bytecode stays the Base contracts. `contracts/deployments/*.json` stay `not-deployed`. The console network selector lists Base (`eip155:8453`) and Base Sepolia (`eip155:84532`).

## What the core owns

Policy evaluation, the four ceilings (`maxFeeAmount`, `maxFeeBps`, `maxGasAmount`, `maxCombinedAmount`), idempotency, the atomic reservation, and the public `BLOCK_*` / `ALLOW_*` reason codes. Ceiling math is `evaluateSpend`. The adapter stores the quote and passes it through.

A quoted fee or gas amount with the matching ceiling omitted fails closed as `BLOCK_FEE_CEILING` or `BLOCK_GAS_CEILING`. Principal + fee + gas above `maxCombinedAmount` is `BLOCK_COMBINED_CEILING` on every rail, including a gas spike on a later EVM chain.

Step-up stays `STEP_UP_ABOVE_THRESHOLD` until the host sets `stepUpSatisfied` after the owner factor is verified. That flag is the host's claim. The adapter does not collect the owner signature.

## What an adapter owns

Chain and rail identity, sequence lease, submission of an already signed payload, inclusion polling, and receipt normalization.

| Spec name | Ledger meaning |
| --- | --- |
| `CREATED` | `CREATED`. The reservation is a hold on this status, not a separate status |
| Nonce or blockhash assigned | `SequenceLease` plus `AttemptRecord.nonce` on EVM. Not a status |
| `IN_FLIGHT` | `IN_FLIGHT_PENDING` |
| `INCLUDED_UNFINALIZED` | `INCLUDED_UNFINALIZED` |
| `FINALIZED` | `FINALIZED`. Irreversible finality commits principal + actual fee + actual gas here and releases unused reserve |
| `FAILED_OR_REVERTED` | `REVERTED` or `FAILED` |
| `EXPIRED_OR_DROPPED` | `EXPIRED_OR_DROPPED` with `BLOCK_DEADLINE_EXCEEDED` |
| Blocked before a record opens | A decision. There is no `BLOCKED` attempt status |

`SERIAL` maps to queue mode `serial`. `CONCURRENT_BOUNDED` maps to `async`. The ledger has no numeric concurrency cap.

Default finality is `irreversible`, including Ethereum L1. Fast inclusion is a host opt-in: `INCLUDED_UNFINALIZED` then commits, and the next attempt can start.

Settlement refs match the ledger grammar: `0x` plus 64 hex characters, or a base58 signature of 64 to 88 characters. An MPP credential that is not already a settlement ref is hashed with keccak256 so the ledger can record one ref. Building that credential stays in `@vaulthropic/mpp`. This package does not import it.

The same `attemptId` returns the same lease and the same settlement ref. A different payload while that attempt is in flight is `BLOCK_ATTEMPT_IN_FLIGHT`. A new attempt that reuses a settled challenge or mandate is `BLOCK_REPLAY`.

## Rails

| Adapter | Ids | Wave | Behavior in this repository |
| --- | --- | --- | --- |
| `base`, `base-sepolia` | `eip155:8453`, `eip155:84532` | v1 | Reference settlement targets. USDC addresses and 6 decimals live on `REFERENCE_CHAINS`. Nonce comes from `setSignerNonce` |
| `arbitrum`, `polygon` | `eip155:42161`, `eip155:137` | wave 2 | The same EVM factory. A policy may name the chain. The v1 selector stays on Base |
| `bsc`, `ethereum` | `eip155:56`, `eip155:1` | wave 3 | The same EVM factory. The catalog names the chain and the symbol. It does not publish a token address |
| `solana`, `solana-devnet` | `solana:mainnet`, `solana:devnet` | wave 3 | `acquireSequence` leases a host-supplied recent blockhash and `expiresAtEpochSec`. No Solana program and no fee-payer key |
| `mpp-tempo` | `mpp:tempo` | wave 3 | HTTP 402 challenge id is `endpointOrMandateRef`. `mpp:tempo` is a rail id. It is not a v1 selector row |

An EVM signer with no `setSignerNonce` is `BLOCK_NONCE_UNAVAILABLE`. A Solana acquire with no blockhash source, or a null lease, uses that same reason. When the blockhash window or the attempt deadline passes, `pollStatus` moves a pre-inclusion attempt to `EXPIRED_OR_DROPPED`, releases the reservation, and a retry with a new blockhash can reserve again.

`releaseSequence` drops a pre-inclusion attempt the host has abandoned. `CREATED` becomes `FAILED`. An in-flight attempt becomes `DROPPED`. The nonce returns to the cursor when it is still the tip.

## Host shape

```ts
const adapter = createBaseSepoliaAdapter({
  ledger,
  policy,
  agentId,
  sessionId,
  now: () => Math.floor(Date.now() / 1000),
  // broadcast and readInclusion are optional operator transports.
});
```

`estimateAndValidate` runs the policy. `acquireSequence` calls `AttemptLedger.begin` and returns the lease. It does not build an EIP-3009 payload. That payload comes from `releaseX402Authorization` in `@vaulthropic/x402` after the same ledger has reserved the attempt. `submitAttempt` moves the record to `IN_FLIGHT_PENDING` only with a settlement ref the host has already signed or broadcast. `pollStatus` reads the ledger, expires a dead lease, and, when `readInclusion` is set, walks the legal status path. A reader that reports `FINALIZED` is recorded as inclusion and then finality, because the ledger does not jump straight to `FINALIZED`.

Adding a rail means a catalog row and, when the rail settles on-chain, its own account or facilitator. It does not mean a second copy of the ceiling rules.
