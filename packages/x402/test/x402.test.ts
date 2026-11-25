import { AttemptLedger, deriveIdempotencyKey, examplePolicy } from "@vaulthropic/core";
import { describe, expect, it } from "vitest";
import { encodePaymentSignature, evaluateX402, parsePaymentRequired, releaseX402Authorization } from "../src/index.js";
import type { X402Required } from "../src/index.js";

const NOW = 1_700_000_000;
const NONCE = `0x${"ab".repeat(32)}` as const;

function required(amount = "1000000", payTo?: string): X402Required {
  const policy = examplePolicy();
  return {
    x402Version: 2,
    resource: { url: "https://merchant.example/quote", mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        amount,
        asset: policy.assets[0]?.asset ?? "",
        payTo: payTo ?? policy.allowlists.recipients[0] ?? "",
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2" },
      },
    ],
  };
}

describe("x402 gate", () => {
  it("withholds the EIP-3009 payload until this ledger reserves it, and keeps a second process from releasing one", () => {
    const policy = examplePolicy();
    const gate = evaluateX402({
      policy,
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      required: required(),
      now: NOW,
    });
    expect(gate.outcome).toBe("allow");
    expect(gate.authorization).toBeUndefined();
    expect(gate.typedData).toBeUndefined();

    const idempotencyKey = deriveIdempotencyKey({
      agentId: "agent-1",
      sessionId: "session-1",
      protocol: "x402",
      requestIntentId: "intent-1",
    });
    const ledger = new AttemptLedger();
    ledger.setSignerNonce(policy.session.signer, "0");
    const reserved = ledger.begin({
      policy,
      chainUsage: { spent: "0", windowStartedAt: NOW - 5 },
      intent: {
        idempotencyKey,
        agentId: "agent-1",
        sessionId: "session-1",
        requestIntentId: "intent-1",
        protocol: "x402",
        environment: "sandbox",
        chain: policy.chains[0] ?? "",
        asset: policy.assets[0]?.asset ?? "",
        recipient: policy.allowlists.recipients[0] ?? "",
        amount: "1000000",
        endpoint: "https://merchant.example/quote",
        now: NOW,
        deadline: NOW + 60,
        signer: policy.session.signer,
        finality: "irreversible",
      },
    });
    expect(reserved.reserved).toBe(true);

    const released = releaseX402Authorization({
      ledger,
      idempotencyKey,
      policy,
      required: required(),
      now: NOW,
      nonce: NONCE,
    });
    expect(released.authorization?.value).toBe("1000000");
    expect(released.authorization?.nonce).toBe(NONCE);
    expect(released.typedData?.primaryType).toBe("TransferWithAuthorization");
    expect(released.typedData?.domain.chainId).toBe(84532);

    const again = releaseX402Authorization({ ledger, idempotencyKey, policy, required: required(), now: NOW });
    expect(again.authorization?.nonce).toBe(NONCE);

    const other = new AttemptLedger();
    other.setSignerNonce(policy.session.signer, "0");
    const withheld = releaseX402Authorization({ ledger: other, idempotencyKey, policy, required: required(), now: NOW, nonce: NONCE });
    expect(withheld.authorization).toBeUndefined();
    expect(withheld.message).toMatch(/withheld/);

    expect(() => releaseX402Authorization({
      ledger,
      idempotencyKey,
      policy,
      required: required(),
      now: NOW,
      processes: 2,
    })).toThrow(/serializable store/);
  });

  it("withholds the authorization on a block and on a step-up", () => {
    const blocked = evaluateX402({
      policy: examplePolicy(),
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      required: required("25000001"),
      now: NOW,
    });
    expect(blocked.reason).toBe("BLOCK_PER_TX_CAP");
    expect(blocked.authorization).toBeUndefined();

    const stepUp = evaluateX402({
      policy: examplePolicy(),
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      required: required("10000000"),
      now: NOW,
    });
    expect(stepUp.outcome).toBe("step_up");
    expect(stepUp.authorization).toBeUndefined();
  });

  it("round-trips a PAYMENT-REQUIRED header and rejects a non-matching network", () => {
    const header = `PAYMENT-REQUIRED: ${encodePaymentSignature(required())}`;
    const parsed = parsePaymentRequired(header);
    expect(parsed.accepts[0]?.network).toBe("eip155:84532");

    const foreign = required();
    foreign.accepts[0] = { ...foreign.accepts[0]!, network: "eip155:1", asset: foreign.accepts[0]!.asset };
    const gate = evaluateX402({
      policy: examplePolicy(),
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      required: foreign,
      now: NOW,
    });
    expect(gate.outcome).toBe("block");
    expect(gate.authorization).toBeUndefined();
  });

  it("withholds the authorization when the quoted fee is above the session ceiling", () => {
    const policy = examplePolicy();
    const gate = evaluateX402({
      policy: { ...policy, limits: { ...policy.limits, maxFeeAmount: "1000" } },
      usage: { spent: "0", windowStartedAt: NOW - 5 },
      required: required(),
      now: NOW,
      quotedFeeAmount: "1001",
    });
    expect(gate.reason).toBe("BLOCK_FEE_CEILING");
    expect(gate.authorization).toBeUndefined();
  });
});
