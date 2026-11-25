import { examplePolicy } from "@vaulthropic/core";
import { describe, expect, it } from "vitest";
import { buildMppCredential, evaluateMpp, parseChallenge, parseReceipt, receiptBindsTx } from "../src/index.js";

const NOW = 1_700_000_000;
const TX = `0x${"cd".repeat(32)}`;

function challengeHeader(amount = "1000000"): string {
  const policy = examplePolicy();
  const request = Buffer.from(
    JSON.stringify({
      amount,
      currency: "USDC",
      recipient: policy.allowlists.recipients[0],
      chain: "eip155:84532",
    }),
  ).toString("base64url");
  return `WWW-Authenticate: Payment id="ch_1", method="exact", intent="charge", request="${request}"`;
}

describe("MPP gate", () => {
  it("parses a challenge and allows a receipt-bound settlement", () => {
    const challenge = parseChallenge(challengeHeader());
    const gate = evaluateMpp({
      policy: examplePolicy(),
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      challenge,
      chain: "eip155:84532",
      now: NOW,
      endpoint: "https://merchant.example/resource",
    });
    expect(gate.outcome).toBe("allow");
    const credential = buildMppCredential({ challenge, decision: gate, txHash: TX });
    expect(credential.payload.hash).toBe(TX);

    const receipt = parseReceipt(
      `Payment-Receipt: ${Buffer.from(JSON.stringify({ method: "exact", reference: TX, status: "success", timestamp: "2026-01-01T00:00:00Z" })).toString("base64url")}`,
    );
    expect(receiptBindsTx(receipt, TX)).toBe(true);
  });

  it("refuses a credential when the policy blocks the challenge", () => {
    const challenge = parseChallenge(challengeHeader("25000001"));
    const gate = evaluateMpp({
      policy: examplePolicy(),
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      challenge,
      chain: "eip155:84532",
      now: NOW,
      endpoint: "https://merchant.example/resource",
    });
    expect(gate.reason).toBe("BLOCK_PER_TX_CAP");
    expect(() => buildMppCredential({ challenge, decision: gate, txHash: TX })).toThrow(/allow decision/);
  });
});
