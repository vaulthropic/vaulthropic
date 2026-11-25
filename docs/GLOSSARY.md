# Glossary

- **PolicyAnchor:** Public commitment and on-chain spend-accounting contract.
- **GuardAccount:** User-owned account that separates owner execution from scoped session execution.
- **Session:** A bounded set of chain-agnostic policy constraints with a TTL and optional epoch window.
- **AttemptLedger:** Lifecycle and reservation record for a settlement attempt. Its atomic boundary is one JavaScript realm.
- **SequenceLease:** A nonce or blockhash lease used to prevent conflicting submission. It is not a ledger state.
- **Step-up:** A required owner factor before a payment at or above `stepUpAbove` is allowed. The public console does not set `stepUpSatisfied`.
- **Authorization withholding:** `evaluateX402` omits the EIP-3009 payload on allow, block, and step-up. `releaseX402Authorization` returns it only for the matching reservation in the same `AttemptLedger`.
- **Console identity:** A passkey or recovered wallet proof for the console. It grants no allowance and is neither the `GuardAccount` owner nor the session signer.
- **Example policy:** The reference `examplePolicy` document. Its hash is not a Decision Lab draft and not an anchor commitment.
- **Non-custodial:** User-owned funds and signing authority remain outside pooled Vaulthropic custody.
