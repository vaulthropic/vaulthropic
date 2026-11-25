# Threat model

This is the v1 reference system. It is not a pentest report.

## Assets

- User USDC (or the configured ERC-20) sitting in a `GuardAccount` the user owns
- The right to move that balance
- Policy commitments users and auditors rely on
- Console credentials: passkeys, wallet sign-in proofs, TOTP seeds, API key tokens

Vaulthropic the company is not an asset custodian in this design. There is no pooled balance to seize.

## Actors

| Actor | Can | Cannot, on the guarded rail |
| --- | --- | --- |
| Account owner | Move the full balance, pause, revoke, recommit | Be blocked by the session policy |
| Session signer | Transfer the policy asset to allowlisted recipients under the caps | `approve`, send native value, change the policy, pay a stranger, exceed a cap, continue after pause, revoke, or expiry |
| Vaulthropic operator | Publish this source, run a console, refuse a hosted signature | Upgrade the anchor, call `charge` for someone else, withdraw from an account |
| Merchant or MCP server | Offer a price and a tool | Add itself to an allowlist |
| Prompt-injected model | Ask the host to call a tool or pay | Pass the gate for a server or tool that is not listed, or for an amount over the cap |

## Assumptions

- The owner key is a chain key held by the user, for example a hardware wallet. This service does not hold it. A console WebAuthn passkey is not that key and is not a session signer.
- The session key's private material is held by the user's agent runtime. The anchor stores only the session address.
- Users deploy `GuardAccount` from the factory or an equivalent account that calls `charge` before every session transfer. A session key that also knows the owner key is outside the model.
- Hosts use the adapters instead of signing EIP-3009 on their own. The USDC contract will accept a valid EIP-3009 signature even when this policy would have blocked it.
- `PresenceVerifier` is not a production mandate verifier. Hosts that settle AP2 replace it with SD-JWT verification.
- The off-chain evaluator is advisory for EIP-3009 and authoritative only when the session path is the guarded account.
- One host process owns a given `AttemptLedger`. `releaseX402Authorization` returns an EIP-3009 payload only for a reservation that ledger holds, and it throws when the host declares more than one process. Two processes that hide from that check and do not share a serializable store can still each reserve the same epoch. The guarded rail still reverts in `charge`. EIP-3009 will not.
- Hosts treat `replay: true` as the existing attempt and do not sign a second payload.
- `FINALIZED` is terminal in the ledger. High-value intents wait for that status. A fast inclusion can still be reverted by a later observation and the budget returns.
- A quoted platform fee is an input. The check is the user ceiling. The evaluator does not compute the quote.
- The identity directory is separate from `GuardAccount` balances.

## In-scope failure

A bug in `charge` or `SpendCall` that lets a session transfer more than the cap, to a non-recipient, or via `approve`. Those are the invariants in `contracts/test/Guard.t.sol`.

A decision function that returns an x402 authorization or an MPP credential when the outcome is not allow.

A commit hook or CI job that accepts an environment file or a PEM private key.

## Out of scope for v1

- Solana, Tempo, and card rails as on-chain enforcement. The attempt ledger can track a Solana blockhash window. It does not deploy a Solana program
- ERC-4337 EntryPoint and paymaster integration. Sponsored gas is a ceiling on the attempt. The reference account is not a 4337 account
- Social recovery, guardians, and spending of arbitrary DeFi selectors
- Guaranteeing that a user who exports their owner key into an agent remains protected
- Compromised RPC endpoints hiding events. The chain still enforces `charge`. An indexer is not the security boundary

## Console identity

- Confusing a passkey or a console wallet signature with an owner key or a session spending key. Impact: treating console auth as custody or as a spend right.
- Typed email as the WebAuthn display name. Impact: the prompt can show an address the user does not control. It is not recovery and not verification.
- Relying-party id binding. Impact: a credential registered for another RP id will not assert here.
- Page-session-only credential storage. Impact: create stores the credential id only, and Sign in with passkey records that id without checking the signature or sign counter. Production needs an identity directory and a sign counter.
- Phishing that mixes the console prompt and the wallet prompt. Impact: the page shows the sign-in message before `personal_sign`, and a wallet signature must stay a zero-allowance console proof. The recovered address is not a guard owner or a session signer. A deployed console verifies the signature again and accepts each nonce once.

## Residual risk

The owner can raise caps by recommitting. That is the user's authority, equivalent to holding the wallet. A stolen owner key drains the account. The session firewall does not claim to stop that.

EIP-3009 payments can be signed by any software that holds the EOA key. Protection there is "the agent never receives that key, and the adapter will not prepare the payload." It is not an on-chain predicate inside USDC.
