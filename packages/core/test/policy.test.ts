import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { anchorDraft, canonicalJson, evaluateSpend, examplePolicy, policyHash, tighten } from "../src/index.js";
import type { EpochUsage, SpendRequest } from "../src/index.js";

const NOW = 1_700_000_000;

function usage(spent = "0"): EpochUsage {
  return { spent, windowStartedAt: NOW - 10 };
}

function request(overrides: Partial<SpendRequest> = {}): SpendRequest {
  const policy = examplePolicy();
  return {
    protocol: "onchain",
    environment: "sandbox",
    chain: policy.chains[0] ?? "",
    asset: policy.assets[0]?.asset ?? "",
    recipient: policy.allowlists.recipients[0] ?? "",
    amount: "1000000",
    now: NOW,
    ...overrides,
  };
}

describe("policy evaluator", () => {
  it("allows a spend inside the caps", () => {
    const decision = evaluateSpend({ policy: examplePolicy(), usage: usage(), request: request() });
    expect(decision.outcome).toBe("allow");
    expect(decision.reason).toBe("ALLOW_WITHIN_POLICY");
    expect(decision.policyHash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("hashes the same document regardless of key order", () => {
    const policy = examplePolicy();
    const { account, ...rest } = policy;
    const reordered = { ...rest, account };
    expect(policyHash(reordered)).toBe(policyHash(policy));
  });

  it("matches the committed canonical fixture", () => {
    const file = readFileSync("contracts/test/fixtures/policy.canonical.json", "utf8").replace(/\n$/, "");
    const canonical = canonicalJson(examplePolicy());
    expect(canonical).toBe(file);
    expect(policyHash(examplePolicy())).toBe(keccak256(toBytes(file)));
  });

  it("blocks per-transaction and epoch overruns before step-up can widen them", () => {
    const policy = examplePolicy();
    expect(evaluateSpend({ policy, usage: usage(), request: request({ amount: "25000001" }) }).reason).toBe("BLOCK_PER_TX_CAP");
    expect(
      evaluateSpend({
        policy,
        usage: usage("90000000"),
        request: request({ amount: "20000000" }),
        stepUpSatisfied: true,
      }).reason,
    ).toBe("BLOCK_EPOCH_CAP");
  });

  it("requires step-up at the threshold and records an allow only when the host verified it", () => {
    const policy = examplePolicy();
    const atThreshold = request({ amount: "10000000" });
    expect(evaluateSpend({ policy, usage: usage(), request: atThreshold }).outcome).toBe("step_up");
    expect(evaluateSpend({ policy, usage: usage(), request: atThreshold, stepUpSatisfied: true }).reason).toBe("ALLOW_STEP_UP");
  });

  it("separates sandbox from Base mainnet and rejects unknown recipients", () => {
    const policy = examplePolicy();
    expect(evaluateSpend({ policy, usage: usage(), request: request({ chain: "eip155:8453" }) }).reason).toBe(
      "BLOCK_SESSION_ENVIRONMENT",
    );
    expect(
      evaluateSpend({
        policy,
        usage: usage(),
        request: request({ recipient: "0x4444444444444444444444444444444444444444" }),
      }).reason,
    ).toBe("BLOCK_RECIPIENT_NOT_ALLOWLISTED");
  });

  it("fail-closes empty and paused policies", () => {
    const policy = examplePolicy();
    expect(evaluateSpend({ policy: { ...policy, session: { ...policy.session, paused: true } }, usage: usage(), request: request() }).reason).toBe("BLOCK_PAUSED");
    expect(evaluateSpend({ policy, usage: usage(), request: request({ endpoint: "https://evil.example/pay" }) }).reason).toBe(
      "BLOCK_ENDPOINT_NOT_ALLOWLISTED",
    );
    expect(evaluateSpend({ policy, usage: usage(), request: request({ endpoint: "https://merchant.example/v1" }) }).outcome).toBe("allow");
  });

  it("rolls the epoch window", () => {
    const policy = examplePolicy();
    const decision = evaluateSpend({
      policy,
      usage: { spent: "100000000", windowStartedAt: NOW - policy.limits.epochSeconds },
      request: request(),
    });
    expect(decision.outcome).toBe("allow");
  });

  it("builds a single-chain anchor draft and refuses a mismatched rail", () => {
    const draft = anchorDraft(examplePolicy());
    expect(draft.perTxCap).toBe(25_000_000n);
    expect(draft.stepUpAbove).toBe(10_000_000n);
    expect(draft.recipients).toHaveLength(1);
    expect(() => anchorDraft({ ...examplePolicy("mainnet"), environment: "sandbox" })).toThrow();
  });

  it("lets a tightener narrow a decision and never widen one", () => {
    const allow = evaluateSpend({ policy: examplePolicy(), usage: usage(), request: request() });
    expect(tighten(allow, "block").outcome).toBe("block");
    expect(tighten(allow, "step_up").outcome).toBe("step_up");
    const blocked = evaluateSpend({ policy: examplePolicy(), usage: usage(), request: request({ amount: "25000001" }) });
    expect(tighten(blocked, "step_up").outcome).toBe("block");
    expect(tighten(blocked, "no_opinion").reason).toBe("BLOCK_PER_TX_CAP");
  });

  it("enforces user fee and gas ceilings without changing the uncapped policy hash", () => {
    const bare = examplePolicy();
    const ceiling = {
      ...bare,
      limits: { ...bare.limits, maxFeeAmount: "10000", maxFeeBps: 100, maxGasAmount: "50000", maxCombinedAmount: "26000000" },
    };
    expect(policyHash(ceiling)).not.toBe(policyHash(bare));
    expect(anchorDraft(ceiling).perTxCap).toBe(25_000_000n);

    expect(evaluateSpend({ policy: ceiling, usage: usage(), request: request({ quotedFeeAmount: "10000", maxGasFee: "1" }) }).outcome).toBe("allow");
    expect(evaluateSpend({ policy: ceiling, usage: usage(), request: request({ quotedFeeAmount: "10001" }) }).reason).toBe("BLOCK_FEE_CEILING");
    expect(evaluateSpend({ policy: bare, usage: usage(), request: request({ quotedFeeAmount: "1" }) }).reason).toBe("BLOCK_FEE_CEILING");
    expect(evaluateSpend({ policy: bare, usage: usage(), request: request({ maxGasFee: "1" }) }).reason).toBe("BLOCK_GAS_CEILING");
    expect(
      evaluateSpend({
        policy: { ...ceiling, limits: { ...ceiling.limits, maxCombinedAmount: "1000000" } },
        usage: usage(),
        request: request({ amount: "1000000", quotedFeeAmount: "1" }),
      }).reason,
    ).toBe("BLOCK_COMBINED_CEILING");
    expect(
      evaluateSpend({
        policy: ceiling,
        usage: { spent: "99900000", windowStartedAt: NOW - 10 },
        request: request({ amount: "100000", maxGasFee: "1" }),
      }).reason,
    ).toBe("BLOCK_EPOCH_CAP");
  });
});
