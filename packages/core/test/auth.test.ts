import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  base32Decode,
  base32Encode,
  createSignInMessage,
  examplePolicy,
  hotp,
  issueApiKey,
  keySpendDenial,
  passkeyCreationOptions,
  revokeApiKey,
  startOAuth,
  verifySignInMessage,
  verifyTotp,
} from "../src/index.js";

describe("sign-in and credentials", () => {
  it("builds a wallet sign-in message that does not grant spend", () => {
    const message = createSignInMessage({
      domain: "vaulthropic.com",
      address: "0x1111111111111111111111111111111111111111",
      nonce: "nonce1234",
      issuedAt: "2026-01-01T00:00:00Z",
      expirationTime: "2026-01-01T00:10:00Z",
      environment: "sandbox",
    });
    expect(message).toContain("Chain ID: 84532");
    expect(message).toContain("does not grant a token allowance");
    expect(message).not.toContain("seed");
  });

  it("recovers the signer and rejects a mismatched, expired, or cross-environment message", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const issuedAt = "2026-01-01T00:00:00Z";
    const expirationTime = "2026-01-01T00:10:00Z";
    const now = Date.parse(issuedAt) + 1_000;
    const message = createSignInMessage({
      domain: "vaulthropic.com",
      address: signer.address,
      nonce: "nonce1234",
      issuedAt,
      expirationTime,
      environment: "sandbox",
    });
    const signature = await signer.signMessage({ message });
    const verified = await verifySignInMessage({ message, signature, now, environment: "sandbox" });
    expect(verified.address).toBe(signer.address);
    expect(verified.chainId).toBe(84532);
    expect(verified).not.toHaveProperty("owner");
    expect(verified).not.toHaveProperty("sessionSigner");

    const wrongSigner = await other.signMessage({ message });
    await expect(verifySignInMessage({ message, signature: wrongSigner, now, environment: "sandbox" })).rejects.toThrow(
      /not made by the address/,
    );
    await expect(verifySignInMessage({ message, signature, now: Date.parse(expirationTime), environment: "sandbox" })).rejects.toThrow(
      /expired/,
    );
    await expect(verifySignInMessage({ message, signature, now, environment: "mainnet" })).rejects.toThrow(/selected environment/);
    const tampered = message.replace("does not grant a token allowance", "grants a token allowance");
    await expect(verifySignInMessage({ message: tampered, signature, now, environment: "sandbox" })).rejects.toThrow(/statement/);
  });

  it("configures a passkey ceremony without attestation or a stored secret", () => {
    const options = passkeyCreationOptions({
      challenge: new Uint8Array(32),
      userId: new Uint8Array(16),
      userName: "ada@merchant.example",
      rpId: "vaulthropic.com",
    });
    expect(options.rp.name).toBe("Vaulthropic");
    expect(options.authenticatorSelection.userVerification).toBe("required");
    expect(options.attestation).toBe("none");
    expect(JSON.stringify(options)).not.toContain("mnemonic");
  });

  it("matches the RFC 6238 SHA-1 vector and a one-step skew window", async () => {
    const secret = new TextEncoder().encode("12345678901234567890");
    expect(await hotp(secret, 1n, 8)).toBe("94287082");
    expect(await hotp(secret, 1n, 6)).toBe("287082");
    expect(await verifyTotp({ secret, code: "94287082", unixSeconds: 59, digits: 8 })).toBe(true);
    expect(await verifyTotp({ secret, code: "00000000", unixSeconds: 59, digits: 8 })).toBe(false);
  });

  it("round-trips base32 secrets", () => {
    const secret = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(base32Decode(base32Encode(secret))).toEqual(secret);
  });

  it("issues a scoped key whose ceiling cannot exceed or outlive the policy", async () => {
    const policy = examplePolicy();
    await expect(issueApiKey({ policy, ceiling: "25000001" })).rejects.toThrow(/cannot loosen/);
    const issued = await issueApiKey({ policy, ceiling: "5000000" });
    expect(issued.token.startsWith("vth_test_")).toBe(true);
    expect(issued.record.hash).not.toBe(issued.token);
    expect(keySpendDenial(issued.record, { environment: "sandbox", policyId: policy.policyId, amount: "4000000" })).toBeNull();
    expect(keySpendDenial(issued.record, { environment: "mainnet", policyId: policy.policyId, amount: "1" })).toBe(
      "BLOCK_SESSION_ENVIRONMENT",
    );
    expect(keySpendDenial(revokeApiKey(issued.record), { environment: "sandbox", policyId: policy.policyId, amount: "1" })).toBe(
      "BLOCK_KEY_REVOKED",
    );
  });

  it("refuses an OAuth start that is missing or carries a client secret", () => {
    expect(() => startOAuth("google", undefined)).toThrow(/no client configuration/);
    expect(() => startOAuth("google", { authorizationUrl: "https://idp.example/auth?client_secret=supersecretvalue" })).toThrow(
      /client secret/,
    );
    expect(startOAuth("google", { authorizationUrl: "https://idp.example/auth?client_id=public" })).toContain("client_id=public");
  });
});
