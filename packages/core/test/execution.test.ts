import { describe, expect, it } from "vitest";
import { AttemptLedger, deriveIdempotencyKey, examplePolicy, normalizePolicy, policyHash } from "../src/index.js";
import type { PaymentIntent, SpendPolicy } from "../src/index.js";

const NOW = 1_700_000_000;
const TX = `0x${"ab".repeat(32)}` as const;
const TX_2 = `0x${"cd".repeat(32)}` as const;
const usage = { spent: "0", windowStartedAt: NOW - 10 };

function policy(): SpendPolicy {
  return examplePolicy();
}

function intent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  const current = policy();
  return {
    agentId: "agent-1",
    sessionId: "session-1",
    requestIntentId: "intent-1",
    protocol: "x402",
    environment: "sandbox",
    chain: current.chains[0] ?? "",
    asset: current.assets[0]?.asset ?? "",
    recipient: current.allowlists.recipients[0] ?? "",
    amount: "1000000",
    now: NOW,
    deadline: NOW + 120,
    signer: current.session.signer,
    finality: "irreversible",
    challengeId: "challenge-1",
    ...overrides,
  };
}

function ledger(): AttemptLedger {
  const book = new AttemptLedger();
  book.setSignerNonce(policy().session.signer, "4");
  return book;
}

describe("attempt ledger", () => {
  it("reserves once and returns the same attempt for the same idempotency key", () => {
    const book = ledger();
    const first = book.begin({ policy: policy(), intent: intent(), chainUsage: usage });
    expect(first.reserved).toBe(true);
    expect(first.replay).toBe(false);
    expect(first.record?.status).toBe("CREATED");
    expect(first.record?.nonce).toBe("4");
    expect(first.record?.reservedAmount).toBe("1000000");

    const second = book.begin({ policy: policy(), intent: intent(), chainUsage: usage });
    expect(second.replay).toBe(true);
    expect(second.reserved).toBe(false);
    expect(second.record?.nonce).toBe("4");
    expect(second.record?.attemptCount).toBe(1);
    expect(book.outstanding(first.record?.policyHash ?? "0x", policy().session.signer)).toBe("1000000");
  });

  it("keeps a second serial attempt from reserving budget", () => {
    const book = ledger();
    const first = book.begin({ policy: policy(), intent: intent(), chainUsage: usage });
    const second = book.begin({
      policy: policy(),
      intent: intent({ requestIntentId: "intent-2", challengeId: "challenge-2" }),
      chainUsage: usage,
    });
    expect(second.decision.reason).toBe("BLOCK_ATTEMPT_IN_FLIGHT");
    expect(second.reserved).toBe(false);
    expect(book.outstanding(first.record?.policyHash ?? "0x", policy().session.signer)).toBe("1000000");
  });

  it("counts an outstanding reservation against the epoch for an async queue", () => {
    const book = ledger();
    const first = book.begin({
      policy: policy(),
      intent: intent({ queue: "async", amount: "20000000", stepUpSatisfied: true }),
      chainUsage: { spent: "70000000", windowStartedAt: NOW - 10 },
    });
    expect(first.reserved).toBe(true);
    const second = book.begin({
      policy: policy(),
      intent: intent({
        queue: "async",
        amount: "20000000",
        stepUpSatisfied: true,
        requestIntentId: "intent-2",
        challengeId: "challenge-2",
      }),
      chainUsage: { spent: "70000000", windowStartedAt: NOW - 10 },
    });
    expect(second.decision.reason).toBe("BLOCK_EPOCH_CAP");
    expect(second.reserved).toBe(false);
    expect(book.outstanding(policyHash(policy()), policy().session.signer)).toBe("20000000");
  });

  it("releases a dropped attempt and reuses the nonce", () => {
    const book = ledger();
    const started = book.begin({ policy: policy(), intent: intent(), chainUsage: usage });
    const key = started.record?.idempotencyKey ?? "";
    expect(book.observe(key, { status: "IN_FLIGHT_PENDING", now: NOW + 1, txHash: TX }).accepted).toBe(true);
    const dropped = book.observe(key, { status: "DROPPED", now: NOW + 2 });
    expect(dropped.record?.status).toBe("DROPPED");
    expect(dropped.record?.nonceReusable).toBe(true);
    expect(book.outstanding(policyHash(policy()), policy().session.signer)).toBe("0");

    const retry = book.begin({ policy: policy(), intent: intent(), chainUsage: usage });
    expect(retry.reserved).toBe(true);
    expect(retry.record?.attemptCount).toBe(2);
    expect(retry.record?.nonce).toBe("4");
  });

  it("settles the actual gas and frees the unused reserve", () => {
    const current = normalizePolicy({
      ...policy(),
      limits: { ...policy().limits, maxGasAmount: "50000", perEpoch: "25000000", stepUpAbove: "25000000" },
    });
    const book = ledger();
    const started = book.begin({
      policy: current,
      intent: intent({ amount: "1000000", maxGasFee: "50000", finality: "irreversible" }),
      chainUsage: usage,
    });
    expect(started.record?.reservedAmount).toBe("1050000");
    const key = started.record?.idempotencyKey ?? "";
    book.observe(key, { status: "IN_FLIGHT_PENDING", now: NOW + 1, txHash: TX });
    book.observe(key, { status: "INCLUDED_UNFINALIZED", now: NOW + 2, txHash: TX });
    const settled = book.observe(key, { status: "FINALIZED", now: NOW + 3, txHash: TX, actualGas: "10000" });
    expect(settled.record?.settled).toBe(true);
    expect(settled.record?.settledAmount).toBe("1010000");

    const follow = book.begin({
      policy: current,
      intent: intent({ amount: "23990000", requestIntentId: "intent-2", challengeId: "challenge-2" }),
      chainUsage: usage,
    });
    expect(follow.decision.reason).toBe("ALLOW_WITHIN_POLICY");
    expect(follow.reserved).toBe(true);
  });

  it("lets a fast attempt continue at inclusion and restores the budget on revert", () => {
    const current = normalizePolicy({
      ...policy(),
      limits: { ...policy().limits, perEpoch: "25000000", stepUpAbove: "25000000" },
    });
    const book = ledger();
    const started = book.begin({
      policy: current,
      intent: intent({ finality: "fast" }),
      chainUsage: usage,
    });
    const key = started.record?.idempotencyKey ?? "";
    book.observe(key, { status: "IN_FLIGHT_PENDING", now: NOW + 1, txHash: TX });
    const included = book.observe(key, { status: "INCLUDED_UNFINALIZED", now: NOW + 2, txHash: TX });
    expect(included.record?.settled).toBe(true);
    expect(included.record?.readyForNext).toBe(true);

    const crowded = book.begin({
      policy: current,
      intent: intent({ amount: "24999999", requestIntentId: "intent-2", challengeId: "challenge-2" }),
      chainUsage: usage,
    });
    expect(crowded.decision.reason).toBe("BLOCK_EPOCH_CAP");

    book.observe(key, { status: "REVERTED", now: NOW + 3, txHash: TX });
    const recovered = book.begin({
      policy: current,
      intent: intent({ amount: "24999999", requestIntentId: "intent-2", challengeId: "challenge-2" }),
      chainUsage: usage,
    });
    expect(recovered.reserved).toBe(true);
  });

  it("holds an irreversible attempt until finalized", () => {
    const book = ledger();
    const started = book.begin({ policy: policy(), intent: intent({ finality: "irreversible" }), chainUsage: usage });
    const key = started.record?.idempotencyKey ?? "";
    book.observe(key, { status: "IN_FLIGHT_PENDING", now: NOW + 1, txHash: TX });
    const included = book.observe(key, { status: "INCLUDED_UNFINALIZED", now: NOW + 2, txHash: TX });
    expect(included.record?.settled).toBe(false);
    expect(included.record?.readyForNext).toBe(false);
    expect(book.outstanding(policyHash(policy()), policy().session.signer)).toBe("1000000");

    const blocked = book.begin({
      policy: policy(),
      intent: intent({ requestIntentId: "intent-2", challengeId: "challenge-2" }),
      chainUsage: usage,
    });
    expect(blocked.decision.reason).toBe("BLOCK_ATTEMPT_IN_FLIGHT");

    const finalized = book.observe(key, { status: "FINALIZED", now: NOW + 4, txHash: TX, receiptId: "receipt-1" });
    expect(finalized.record?.readyForNext).toBe(true);
    expect(finalized.record?.settledAmount).toBe("1000000");
  });

  it("expires a Solana attempt when its blockhash window ends", () => {
    const current = normalizePolicy({
      version: "1",
      policyId: "example-solana",
      account: "agent-account",
      environment: "sandbox",
      chains: ["solana:devnet"],
      assets: [{ chain: "solana:devnet", asset: "usdc-solana", symbol: "USDC", decimals: 6 }],
      limits: { ...policy().limits, maxGasAmount: "50000" },
      allowlists: {
        recipients: ["merchant-1"],
        endpoints: ["https://merchant.example"],
        mcp: [{ server: "https://mcp.example.com", tools: ["quote"] }],
      },
      mandates: { requireIntentForAutonomous: true, maxMandateTtlSeconds: 86_400 },
      session: { signer: "agent-session", validUntil: 1_893_456_000, paused: false },
    });
    const book = new AttemptLedger();
    const started = book.begin({
      policy: current,
      intent: {
        agentId: "agent-1",
        sessionId: "session-1",
        requestIntentId: "intent-1",
        protocol: "x402",
        environment: "sandbox",
        chain: "solana:devnet",
        asset: "usdc-solana",
        recipient: "merchant-1",
        amount: "1000000",
        now: NOW,
        deadline: NOW + 90,
        signer: "agent-session",
        finality: "fast",
        maxGasFee: "50000",
        blockhashExpiresAt: NOW + 30,
        challengeId: "challenge-sol",
      },
      chainUsage: usage,
    });
    expect(started.reserved).toBe(true);
    expect(started.record?.nonce).toBeUndefined();
    const expired = book.expireDue(NOW + 30);
    expect(expired[0]?.status).toBe("EXPIRED_OR_DROPPED");
    expect(book.outstanding(policyHash(current), "agent-session")).toBe("0");

    const retry = book.begin({
      policy: current,
      intent: {
        agentId: "agent-1",
        sessionId: "session-1",
        requestIntentId: "intent-1",
        protocol: "x402",
        environment: "sandbox",
        chain: "solana:devnet",
        asset: "usdc-solana",
        recipient: "merchant-1",
        amount: "1000000",
        now: NOW + 31,
        deadline: NOW + 120,
        signer: "agent-session",
        finality: "fast",
        maxGasFee: "50000",
        blockhashExpiresAt: NOW + 80,
        challengeId: "challenge-sol",
      },
      chainUsage: { spent: "0", windowStartedAt: NOW },
    });
    expect(retry.reserved).toBe(true);
    expect(retry.record?.attemptCount).toBe(2);
  });

  it("blocks a quoted fee or gas budget that the session has not ceilinged", () => {
    const book = ledger();
    const nakedFee = book.begin({
      policy: policy(),
      intent: intent({ quotedFeeAmount: "1" }),
      chainUsage: usage,
    });
    expect(nakedFee.decision.reason).toBe("BLOCK_FEE_CEILING");
    expect(nakedFee.reserved).toBe(false);

    const capped = normalizePolicy({
      ...policy(),
      limits: { ...policy().limits, maxFeeAmount: "100000", maxFeeBps: 500, maxCombinedAmount: "1000000" },
    });
    const overCombined = book.begin({
      policy: capped,
      intent: intent({ amount: "1000000", quotedFeeAmount: "1", requestIntentId: "intent-fee" }),
      chainUsage: usage,
    });
    expect(overCombined.decision.reason).toBe("BLOCK_COMBINED_CEILING");

    const gas = book.begin({
      policy: policy(),
      intent: intent({ maxGasFee: "1", requestIntentId: "intent-gas" }),
      chainUsage: usage,
    });
    expect(gas.decision.reason).toBe("BLOCK_GAS_CEILING");
    expect(book.outstanding(policyHash(policy()), policy().session.signer)).toBe("0");
  });

  it("rejects a replay of a settled challenge and an illegal jump to finalized", () => {
    const book = ledger();
    const started = book.begin({ policy: policy(), intent: intent(), chainUsage: usage });
    const key = started.record?.idempotencyKey ?? "";
    const illegal = book.observe(key, { status: "FINALIZED", now: NOW + 1, txHash: TX });
    expect(illegal.accepted).toBe(false);
    expect(book.get(key)?.status).toBe("CREATED");

    book.observe(key, { status: "IN_FLIGHT_PENDING", now: NOW + 1, txHash: TX });
    book.observe(key, { status: "INCLUDED_UNFINALIZED", now: NOW + 2, txHash: TX });
    book.observe(key, { status: "FINALIZED", now: NOW + 3, txHash: TX, receiptId: "receipt-1" });
    const replay = book.begin({
      policy: policy(),
      intent: intent({ requestIntentId: "intent-2" }),
      chainUsage: usage,
    });
    expect(replay.decision.reason).toBe("BLOCK_REPLAY");
    expect(replay.reserved).toBe(false);
  });

  it("leaves a nonce gap when an earlier async attempt drops", () => {
    const book = ledger();
    const first = book.begin({
      policy: policy(),
      intent: intent({ queue: "async", amount: "1000000" }),
      chainUsage: usage,
    });
    const second = book.begin({
      policy: policy(),
      intent: intent({ queue: "async", amount: "1000000", requestIntentId: "intent-2", challengeId: "challenge-2" }),
      chainUsage: usage,
    });
    expect(first.record?.nonce).toBe("4");
    expect(second.record?.nonce).toBe("5");
    const dropped = book.observe(first.record?.idempotencyKey ?? "", { status: "FAILED", now: NOW + 1 });
    expect(dropped.record?.nonceReusable).toBe(false);
    const third = book.begin({
      policy: policy(),
      intent: intent({ queue: "async", amount: "1000000", requestIntentId: "intent-3", challengeId: "challenge-3" }),
      chainUsage: usage,
    });
    expect(third.record?.nonce).toBe("6");
  });

  it("derives a stable idempotency key and keeps a replacement on the same nonce", () => {
    const parts = { agentId: "agent-1", sessionId: "session-1", protocol: "x402" as const, requestIntentId: "intent-1" };
    expect(deriveIdempotencyKey(parts)).toBe(deriveIdempotencyKey(parts));

    const book = ledger();
    const started = book.begin({ policy: policy(), intent: intent({ idempotencyKey: deriveIdempotencyKey(parts) }), chainUsage: usage });
    const key = started.record?.idempotencyKey ?? "";
    book.observe(key, { status: "IN_FLIGHT_PENDING", now: NOW + 1, txHash: TX });
    const replaced = book.observe(key, { status: "REPLACED", now: NOW + 2, txHash: TX_2 });
    expect(replaced.accepted).toBe(true);
    expect(replaced.record?.nonce).toBe("4");
    expect(replaced.record?.readyForNext).toBe(false);
    expect(book.outstanding(policyHash(policy()), policy().session.signer)).toBe("1000000");
  });

  it("does not reserve a step-up", () => {
    const book = ledger();
    const result = book.begin({
      policy: policy(),
      intent: intent({ amount: "10000000" }),
      chainUsage: usage,
    });
    expect(result.decision.outcome).toBe("step_up");
    expect(result.reserved).toBe(false);
    expect(result.record).toBeUndefined();
  });
});
