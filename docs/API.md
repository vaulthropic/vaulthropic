# Public API and integration contract

This document defines compatibility expectations for public package interfaces and protocol adapters.

## Stability levels

- `stable`: public interface, schema, reason code, or behavior that requires a migration note before change.
- `beta`: supported for integration but may change after a deprecation period.
- `internal`: not a public compatibility promise.

## Requests and responses

Integration requests must include the chain or rail identifier, asset, amount, recipient or target, requested action, and an idempotency key where an attempt or mandate can be retried. Responses must preserve a deterministic policy reason code and must not fabricate settlement receipts.

Canonical outcomes are `allow`, `block`, and `step_up`. Each decision also carries a reason code from `REASON_CODES` in `@vaulthropic/core`: `ALLOW_WITHIN_POLICY`, `ALLOW_STEP_UP`, `STEP_UP_ABOVE_THRESHOLD`, `STEP_UP_TIGHTENED`, and the named `BLOCK_*` codes, including `BLOCK_MALFORMED_REQUEST` and `BLOCK_TIGHTENED`. Ledger statuses are only `CREATED`, `IN_FLIGHT_PENDING`, `INCLUDED_UNFINALIZED`, `FINALIZED`, `DROPPED`, `REPLACED`, `REVERTED`, `EXPIRED_OR_DROPPED`, and `FAILED`.

`evaluateX402` returns that decision and omits the EIP-3009 authorization on allow, block, and step-up. `releaseX402Authorization` returns the unsigned payload only when the same single-realm `AttemptLedger` holds the matching `CREATED` x402 reservation: policy hash, chain, principal, quoted fee, gas, asset, and recipient. A missing or mismatched reservation is `BLOCK_MALFORMED_REQUEST` and carries no authorization. Declaring `processes` other than 1 throws until one serializable store reserves the budget. A later release of the same reservation returns the same 32-byte payload nonce.

## Compatibility

Breaking changes require a changelog entry, migration instructions, tests, and a release record. Signable authorization stays off a block, a step-up, and an x402 allow until `releaseX402Authorization` accepts the reservation. Servers must reject replay, in-flight duplicates, stale deadlines, unavailable nonce sequences, and unsupported environments.
