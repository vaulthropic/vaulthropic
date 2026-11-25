# Sign-in

Registration opens a console. It does not open an account at Vaulthropic that holds money, and it does not start a KYC file.

## Passkey

`passkeyCreationOptions` builds a WebAuthn create request:

- relying party name `Vaulthropic`
- relying party id `vaulthropic.com` or `localhost`
- user verification required
- resident key preferred
- ES256 (`-7`) and RS256 (`-257`)
- attestation `none`
- timeout 60 seconds

The console generates a 32-byte challenge and a 16-byte user id with `crypto.getRandomValues`. `user.name` and `displayName` are the parsed name the user typed, lowercased when it is an email. WebAuthn shows that name in the browser prompt. It does not prove the user controls the inbox. The user id is a random handle, not the address.

The sign-in field starts empty. Create passkey stays disabled until `consoleUserName` accepts the string. Sign in with passkey stays disabled while that field contains a name the parser rejects. An empty field can assert a passkey already on the device. Neither control calls WebAuthn until the click. A placeholder is not submitted. The sample `ada@merchant.example` may remain in unit-test fixtures only, never as the UI default.

Create passkey calls `navigator.credentials.create`. The page session stores `ceremony: "create"`, `userName`, `credentialId`, and `emailStatus`. It does not store a COSE public key, and it does not generate an EVM or Solana key.

Sign in with passkey calls `navigator.credentials.get` through `passkeyRequestOptions`. User verification is required. The request omits `allowCredentials`, so the platform shows discoverable passkeys for this relying party. The page session stores `ceremony: "assert"` and the credential id. A typed email or username is a label only. An empty field stores `emailStatus: "unlinked"` and no `userName`. The authenticator user handle is not read as an email or an address. This build does not check the assertion signature or the sign counter. Production verification of that assertion belongs in the private identity service, which checks the COSE public key captured at registration and the sign counter. This repository does not ship that database.

`shortcut: the console keeps the credential id in page memory only; upgrade when an identity directory stores the credential id, COSE public key, and sign counter.`

## Passkey and email

The console calls WebAuthn only from Create passkey or Sign in with passkey. Typing and leaving the field do not create or assert a credential. Create passkey runs after the email or username passes a local check. `emailStatus` is `unverified` for an email, `username` when there is no email, and `unlinked` when an assertion carries no typed label. An email is stored as an unverified console identity. This build does not send a confirmation message and does not treat that address as verified. The passkey is not a spending key.

## Identity directory

A production console should have an identity directory of users and credentials, separate from settlement and from `GuardAccount` balances. It records the opaque user handle (the WebAuthn `user.id`), display name, email verification status, credential id, COSE public key, and sign counter. It must not hold balances, seed phrases, owner keys, or session private keys. It is not a custody ledger and not KYC.

## Wallet signature

The console lists wallets that announce EIP-6963, or a legacy injected provider when nothing announces. Choosing a row calls `eth_requestAccounts` on that provider and then shows the exact `createSignInMessage` text in the page. Opening the picker does not. `personal_sign` runs only from Sign this message, and the parameter is the hex of that previewed text. The passkey path in the picker only returns focus to the console form.

`createSignInMessage` builds an EIP-4361 style message bound to domain, address, nonce, chain id, and a 10-minute expiry. Sandbox uses chain id `84532` (Base Sepolia). Mainnet uses `8453` (Base). The statement says the signature does not grant a token allowance, a session spend right, or custody. The URI must be the origin of `localhost` or `https://vaulthropic.com`. The private key stays in the wallet.

`verifySignInMessage` recovers the signer and checks the statement, domain, URI, chain id, nonce, and expiry. The page runs that check before it shows the address. The recovered address is a console proof. The console does not copy it into a guard-owner field or a session-signer field. A deployed console must call `verifySignInMessage` again, and accept each nonce once, before it trusts the address. This page keeps no nonce store. The environment selector lists those two v1 networks. Policy checks and AttemptLedger stay chain-agnostic for x402, AP2, MPP, and MCP.

## TOTP and OAuth

TOTP follows RFC 6238, HMAC-SHA1, with one step of clock skew. The console can enroll a secret and verify a code in memory so the factor is real. A deployed console stores the verifier seed in the identity directory.

The console disables Continue with OAuth and labels it for a later release. `startOAuth` throws `OAuthNotConfiguredError` until a host injects an authorization URL. That URL must be `https` and must not contain `client_secret` or URL userinfo. The environment sample does not contain a client secret.

## API keys and environment

`issueApiKey` draws 32 random bytes.

- sandbox → `vth_test_…`
- mainnet → `vth_live_…`

The returned record stores the SHA-256 hash, a display prefix, the policy id, and a ceiling. Creation throws if the ceiling is above the policy per-transaction cap. `keySpendDenial` blocks revoked keys, cross-environment use, a mismatched policy id, and amounts above the ceiling. Revocation flips a flag on the record. The token is shown once.

The public console keeps that token, its hash, and any TOTP seed in component state. Refresh clears them. A matching TOTP code reports that the factor matched and that no payment was authorized. A `vth_live_` token from this page is still that page-local demo while `contracts/deployments/` stays `not-deployed`. A production directory would store the hash, not the token.

A sandbox key cannot be presented to a mainnet request. A sandbox policy that lists `eip155:8453` is rejected at normalization, and a sandbox request for that chain is `BLOCK_SESSION_ENVIRONMENT`.

## What sign-in is not

The owner key of a `GuardAccount` is a separate wallet the user controls. Signing into the console does not set that owner and does not install a session signer. A verified wallet address stays a console proof until the user explicitly assigns it in a later owner action. This console has no control that performs that assignment. Publishing a policy is an owner transaction to `commitPolicy`. The session signer address stored on the anchor is a public address, not a key this service can export.
