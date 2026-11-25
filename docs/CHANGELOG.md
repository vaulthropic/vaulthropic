# Changelog

This file records public, user-visible changes. Security-sensitive details should be withheld until a fix is deployed and safe to disclose.

## Unreleased

- The public license is the MIT license in `LICENSE`. Contributor terms are in `CONTRIBUTING.md` and `CLA.md`. The name and brand are reserved in `TRADEMARKS.md`. The CLA workflow stays skipped until `CLA_GATE_ENABLED` is set.
- Issue forms, the pull request template, and the CLA gate tell contributors how to pass `Vaulthropic CLA`. The recommended comment has no trailing period, and one trailing period also passes. A pull request comment runs the check again.
- The landing page fits one viewport, with an edge-to-edge header shared by the guide. Sign-in is one card: Wallet Signature, and Passkey (Optional) only when the browser reports a platform authenticator. The Decision Lab is its own screen, with a Testnet rehearsal and a Mainnet tab that does not store credentials or settle while deployment addresses are null.
- The `/docs` reading surface renders from MDX. `/docs/usdc-apis` explains the 402 retry, endpoint prefixes, `payTo` allowlisting, and provider setup. Existing `/docs#...` section links stay on the guide.
- Product and engineering documentation lives in `docs/`. See `docs/REPOSITORY.md`.
- `evaluateX402` returns the decision and omits the EIP-3009 payload. `releaseX402Authorization` returns that payload only when the same single-realm `AttemptLedger` holds the matching `CREATED` reservation. `processes` other than 1 throws until one serializable store reserves the budget.
- Console sign-in splits Create passkey and Sign in with passkey. Wallet sign-in shows the message, then recovers the signer. Guard owner and session signer stay unassigned.
- The Decision Lab stores a draft only after an explicit save. The console labels the example policy hash. There is no user dashboard in this build.
