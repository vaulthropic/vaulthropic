# Contracts

Immutable, escrow-free policy enforcement for a user-owned account.

| Contract | Role |
| --- | --- |
| `PolicyAnchor` | Stores the commitment and accounts for session spend. Holds no tokens and has no admin |
| `GuardAccount` | Owner can always move funds. Session key can only `transfer` the committed asset to an allowlisted recipient |
| `GuardAccountFactory` | CREATE2-deploys an account. Does not retain ownership |
| `SpendCall` | Accepts ERC-20 `transfer` only |
| `AttemptModel` | Shared attempt-status vocabulary. It does not hold funds, reserve a budget, or settle a transfer |

## Test

```bash
forge install foundry-rs/forge-std --no-git
forge test
```

From the repo root, `pnpm test:contracts` runs the same tests. Foundry's config lives at the repository root. Install forge-std with `forge install foundry-rs/forge-std --no-git` before the first run.

## Deploy

The script reads the deployer key from the environment. Nothing in the script is a key.

```bash
export DEPLOYER_PRIVATE_KEY=...
export BASE_SEPOLIA_RPC_URL=...
forge script contracts/script/Deploy.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --verify
```

Run that from the repository root on a machine whose `.env` is not staged. After the bytecode is verified, write the addresses into `contracts/deployments/base-sepolia.json` or `contracts/deployments/base.json` and replace `"status": "not-deployed"`. A null address means this repository is not claiming a deployment.

Users then call `GuardAccountFactory.createAccount`. Each user is the owner of their own account. The factory call does not transfer assets.

## Invariants the tests lock

- Session spend at or above `stepUpAbove` reverts, and the owner can still transfer that amount.
- A sixth epoch spend that would pass the cap reverts, and the balance stays put.
- The next epoch window resets `epochSpent`.
- Unknown recipients, the wrong token, `approve`, and native value revert.
- Pause and revoke stop the session. Pause does not stop the owner.
- A session call cannot replace the policy hash.
- Recommit replaces recipients and resets spend.
- The anchor rejects ether. Charging from the session signer directly does not touch the account's budget.
- `predict` matches the CREATE2 address.
