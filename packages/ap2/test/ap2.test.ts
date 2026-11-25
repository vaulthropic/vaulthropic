import { examplePolicy } from "@vaulthropic/core";
import { describe, expect, it } from "vitest";
import { PresenceVerifier, cartCommitment, evaluateAp2 } from "../src/index.js";
import type { Mandate } from "../src/index.js";

const NOW = 1_700_000_000;
const signatures = new PresenceVerifier();
const SIGNATURE = "demo-signature-01";

function mandate(overrides: Partial<Mandate> & Pick<Mandate, "mandateType">): Mandate {
  const policy = examplePolicy();
  return {
    id: `${overrides.mandateType}-1`,
    payer: policy.account,
    payee: policy.allowlists.recipients[0],
    amount: { value: "1000000", currency: "USDC" },
    issuedAt: NOW - 60,
    expiresAt: NOW + 600,
    nonce: "nonce-1",
    signature: SIGNATURE,
    ...overrides,
  };
}

describe("AP2 mandates", () => {
  it("allows a payment that stays inside the intent and binds the cart", () => {
    const cart = mandate({ mandateType: "cart" });
    const gate = evaluateAp2({
      policy: examplePolicy(),
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      chain: "eip155:84532",
      now: NOW,
      endpoint: "https://merchant.example/checkout",
      signatures,
      intent: mandate({ mandateType: "intent", amount: { value: "5000000", currency: "USDC" } }),
      cart,
      payment: mandate({ mandateType: "payment", cartHash: cartCommitment(cart) }),
    });
    expect(gate.outcome).toBe("allow");
    expect(gate.cartCommitment).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("blocks an over-intent amount, a bad cart hash, and a missing signature", () => {
    const cart = mandate({ mandateType: "cart", amount: { value: "1000000", currency: "USDC" } });
    const over = evaluateAp2({
      policy: examplePolicy(),
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      chain: "eip155:84532",
      now: NOW,
      signatures,
      intent: mandate({ mandateType: "intent", amount: { value: "500000", currency: "USDC" } }),
      cart,
      payment: mandate({ mandateType: "payment", cartHash: cartCommitment(cart) }),
    });
    expect(over.reason).toBe("BLOCK_MANDATE_AMOUNT");

    const mismatch = evaluateAp2({
      policy: examplePolicy(),
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      chain: "eip155:84532",
      now: NOW,
      signatures,
      intent: mandate({ mandateType: "intent", amount: { value: "5000000", currency: "USDC" } }),
      cart,
      payment: mandate({ mandateType: "payment", cartHash: `0x${"11".repeat(32)}` }),
    });
    expect(mismatch.reason).toBe("BLOCK_CART_MISMATCH");

    const unsigned = evaluateAp2({
      policy: examplePolicy(),
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      chain: "eip155:84532",
      now: NOW,
      signatures,
      intent: mandate({ mandateType: "intent", signature: "short" }),
      payment: mandate({ mandateType: "payment" }),
    });
    expect(unsigned.reason).toBe("BLOCK_MANDATE_SIGNATURE");
  });

  it("keeps a quoted fee inside the signed intent ceiling", () => {
    const cart = mandate({ mandateType: "cart" });
    const overIntent = evaluateAp2({
      policy: examplePolicy(),
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      chain: "eip155:84532",
      now: NOW,
      signatures,
      quotedFeeAmount: "1",
      intent: mandate({ mandateType: "intent", amount: { value: "1000000", currency: "USDC" } }),
      cart,
      payment: mandate({ mandateType: "payment", cartHash: cartCommitment(cart) }),
    });
    expect(overIntent.reason).toBe("BLOCK_MANDATE_AMOUNT");

    const policy = examplePolicy();
    const allowed = evaluateAp2({
      policy: { ...policy, limits: { ...policy.limits, maxFeeAmount: "1000" } },
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      chain: "eip155:84532",
      now: NOW,
      signatures,
      quotedFeeAmount: "1000",
      intent: mandate({ mandateType: "intent", amount: { value: "5000000", currency: "USDC" } }),
      cart,
      payment: mandate({ mandateType: "payment", cartHash: cartCommitment(cart) }),
    });
    expect(allowed.outcome).toBe("allow");
  });
});
