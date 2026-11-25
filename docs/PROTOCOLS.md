# Protocol adapters

Each adapter returns the shared `SpendDecision`: `allow`, `block`, or `step_up`, plus a stable `reason`. Reason text lives in `@vaulthropic/core`.

## x402

Package: `@vaulthropic/x402`.

Speaks x402 **version 2** headers:

| Header | Direction | Adapter |
| --- | --- | --- |
| `PAYMENT-REQUIRED` | server → client | `parsePaymentRequired` accepts the header or the raw JSON, base64 or plain |
| `PAYMENT-SIGNATURE` | client → server | `encodePaymentSignature` base64-encodes a payload the host has signed |
| `PAYMENT-RESPONSE` | server → client | The host reads the settlement hash. This package does not settle |

`evaluateX402` selects the first `exact` requirement whose CAIP-2 network and asset are on the policy. It then evaluates amount, `payTo`, the resource URL, and any `quotedFeeAmount` or `maxGasFee` the host passes from the payment quote. Allow, block, and step-up all omit the EIP-3009 authorization. `releaseX402Authorization` returns that authorization (`from`, `to`, `value`, `validAfter`, `validBefore`, `nonce`) and typed data only when the same `AttemptLedger` holds a `CREATED` x402 reservation whose outcome is allow. The reservation must match policy hash, chain, principal, quoted fee, gas, asset, and recipient. A ledger that does not hold that reservation returns `BLOCK_MALFORMED_REQUEST` and no authorization. Repeating the release returns the same 32-byte payload nonce. Typed data is included when `extra.name` and `extra.version` are present. The typed-data domain binds `chainId` and the token as `verifyingContract`. The host signs with the user's wallet. No key parameter exists on the function. Passing `processes` other than 1 throws: one serializable store has to reserve the budget before more than one host process can release a payload. A quoted fee still has to pass the session fee ceiling before `begin` reserves the attempt. See [EXECUTION.md](EXECUTION.md).

A requirement that matches no policy chain and asset is `BLOCK_CHAIN_NOT_ALLOWLISTED` and carries no authorization. The console page `/docs/usdc-apis` explains how a host applies these checks to a third-party pay-per-call API. It does not add a recipient or an endpoint to the allowlist.

## AP2

Package: `@vaulthropic/ap2`.

The evaluator uses the launch mandate names from the product requirements:

| Mandate | Role | Later spec alias |
| --- | --- | --- |
| `intent` | Ceiling, merchant list, TTL | Open checkout mandate |
| `cart` | Exact cart, merchant, amount | Closed checkout mandate |
| `payment` | Amount, payee, cart commitment | Payment mandate |

`PresenceVerifier` only checks that a signature string is at least 16 characters. It is the test double. A production host passes an SD-JWT verifier with the same `verify(mandate)` shape. Failed verification is `BLOCK_MANDATE_SIGNATURE`, not an allow.

Checks, in order: required intent when the policy says so, type tags, issued/expiry window inside `maxMandateTtlSeconds`, signature, intent ceiling and merchant list, cart amount and payee, `payment.cartHash === cartCommitment(cart)`, then `evaluateSpend`. The intent ceiling covers the payment principal plus `quotedFeeAmount` plus `maxGasFee`. The cart still binds the merchandise principal. `cartCommitment` is keccak256 of the canonical cart with `signature` and `cartHash` removed.

## MPP

Package: `@vaulthropic/mpp`.

`parseChallenge` reads `WWW-Authenticate: Payment` auth-params (`id`, `method`, `intent`, `request`) and base64url-decodes `request` as JSON `{ amount, currency, recipient, chain }`. `evaluateMpp` sends that spend, plus any quoted fee and gas budget, into the policy. An `expires` timestamp in the past is `BLOCK_MANDATE_EXPIRED`. `buildMppCredential` still throws unless the outcome is allow, so a fee-ceiling block never becomes a credential.

`buildMppCredential` throws unless the decision outcome is `allow` and `txHash` is 32 bytes. The credential payload is `{ type: "hash", hash }` and is encoded as `Authorization: Payment` via `encodeCredential`. Vaulthropic does not broadcast the transaction. The caller supplies the hash after the guarded transfer or their own signer settles.

`parseReceipt` reads `Payment-Receipt`. `receiptBindsTx` is true only when `status` is `success` and `reference` matches the hash.

## MCP

Package: `@vaulthropic/mcp-gate`.

The host must call `gateMcpToolCall` before the MCP transport write. It matches the server URL and the tool name against the policy allowlist. Unknown servers and tools are blocked even if the arguments look harmless. Prompt text is not an input. A model cannot talk a tool onto the list. This gate returns a policy decision; the host must separately use `AttemptLedger` when a paid tool call needs an attempt reservation.

If the arguments include a payment shape (`amount` / `value` / `maxAmountRequired` and `to` / `recipient` / `payTo`), the gate also runs `evaluateSpend`. `quotedFeeAmount` / `feeAmount` and `maxGasFee` / `gasBudget` ride along when present. An endpoint-only argument must match the endpoint allowlist. A partial payment shape is `BLOCK_MALFORMED_REQUEST`.

## Reason codes

Allow: `ALLOW_WITHIN_POLICY`, `ALLOW_STEP_UP`.

Spend blocks: `BLOCK_PER_TX_CAP`, `BLOCK_EPOCH_CAP`, `BLOCK_FEE_CEILING`, `BLOCK_GAS_CEILING`, `BLOCK_COMBINED_CEILING`, `BLOCK_RECIPIENT_NOT_ALLOWLISTED`, `BLOCK_ASSET_NOT_ALLOWLISTED`, `BLOCK_CHAIN_NOT_ALLOWLISTED`, `BLOCK_ENDPOINT_NOT_ALLOWLISTED`, `BLOCK_SESSION_EXPIRED`, `BLOCK_SESSION_ENVIRONMENT`, `BLOCK_PAUSED`.

Attempt blocks: `BLOCK_REPLAY`, `BLOCK_ATTEMPT_IN_FLIGHT`, `BLOCK_NONCE_UNAVAILABLE`, `BLOCK_DEADLINE_EXCEEDED`.

Mandate and MCP: `BLOCK_MANDATE_MISSING`, `BLOCK_MANDATE_EXPIRED`, `BLOCK_MANDATE_AMOUNT`, `BLOCK_MANDATE_PAYEE`, `BLOCK_MANDATE_SIGNATURE`, `BLOCK_CART_MISMATCH`, `BLOCK_MCP_SERVER_NOT_ALLOWLISTED`, `BLOCK_MCP_TOOL_NOT_ALLOWLISTED`.

Keys: `BLOCK_KEY_REVOKED`, `BLOCK_KEY_POLICY`, `BLOCK_KEY_CEILING`.

Step-up: `STEP_UP_ABOVE_THRESHOLD`, `STEP_UP_TIGHTENED`. A private tightener may also emit `BLOCK_TIGHTENED`.
