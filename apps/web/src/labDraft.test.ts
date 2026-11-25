import { describe, expect, it } from "vitest";
import { runLab } from "./lab.js";
import { defaultDraft, draftToInput, findContradictions, fixContradiction } from "./labDraft.js";

const NOW = 1_700_000_000;
const RECIPIENT = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

describe("decision lab contradictions", () => {
  it("names a step-up that can never fire, a per-tx cap above the epoch, and a combined ceiling under the quote", () => {
    const stepUp = findContradictions({ ...defaultDraft("sandbox"), stepUp: "15", maxPerTx: "10" });
    expect(stepUp[0]?.message).toContain("step-up threshold (15 USDC) is higher than your per-transaction cap (10 USDC)");
    const perTx = findContradictions({ ...defaultDraft("sandbox"), maxPerTx: "50", epochBudget: "25" });
    expect(perTx[0]?.message).toContain("single-transaction cap (50 USDC) exceeds your entire epoch budget (25 USDC)");
    const combined = findContradictions({
      ...defaultDraft("sandbox"),
      maxCombinedAmount: "10",
      amount: "10",
      quotedFee: "0.40",
      estimatedGas: "0.05",
    });
    expect(combined.map((item) => item.message).join("\n")).toContain("maxCombinedAmount (10 USDC) is smaller than principal + fee + gas (10.45 USDC)");
    expect(combined.map((item) => item.message).join("\n")).toContain("BLOCK_COMBINED_CEILING");
  });

  it("warns on a zero TTL and a recipient outside the allowlist", () => {
    const draft = { ...defaultDraft("sandbox"), ttlSeconds: "0", recipient: "0x5555555555555555555555555555555555555555" };
    const [alert] = findContradictions(draft);
    expect(alert?.kind).toBe("ttl_or_allowlist");
    expect(alert?.message).toContain("Session TTL is 0s");
    expect(alert?.message).toContain("BLOCK_RECIPIENT_NOT_ALLOWLISTED");
    expect(alert?.message).toContain("BLOCK_DEADLINE_EXCEEDED");
  });

  it("warns when a quoted fee or gas budget has no ceiling", () => {
    const draft = { ...defaultDraft("sandbox"), quotedFee: "0.02", estimatedGas: "0.01" };
    const kinds = findContradictions(draft).map((item) => item.kind);
    expect(kinds).toEqual(["fee_ceiling_missing", "gas_ceiling_missing"]);
  });

  it("accepts equal caps and a combined ceiling that matches principal + fee + gas", () => {
    const draft = { ...defaultDraft("sandbox"), stepUp: "25", maxPerTx: "25", epochBudget: "25", maxCombinedAmount: "1", amount: "1" };
    expect(findContradictions(draft)).toEqual([]);
  });

  it("fixes every contradictory field in one pass per alert", () => {
    let draft = {
      ...defaultDraft("mainnet"),
      stepUp: "15",
      maxPerTx: "50",
      epochBudget: "25",
      maxCombinedAmount: "10",
      amount: "10",
      quotedFee: "0.40",
      estimatedGas: "0.05",
      ttlSeconds: "0",
      recipient: "0x5555555555555555555555555555555555555555",
      maxFeeAmount: "",
      maxFeeBps: "",
      maxGasAmount: "",
    };
    for (let pass = 0; pass < 4; pass += 1) {
      const alerts = findContradictions(draft);
      if (alerts.length === 0) break;
      for (const alert of alerts) draft = fixContradiction(draft, alert.kind);
    }
    expect(findContradictions(draft)).toEqual([]);
    expect(draft.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(draft.ttlSeconds).toBe("86400");
    expect(draft.maxFeeAmount).toBe("0.40");
    expect(draft.maxGasAmount).toBe("0.05");
  });
});

describe("decision lab drafts", () => {
  it("keeps the example allow, step-up, and per-tx block when the form is at its defaults", () => {
    const base = defaultDraft("sandbox");
    expect(runLab(draftToInput({ ...base, amount: "1" }), NOW)).toMatchObject({ decision: { outcome: "allow" } });
    expect(runLab(draftToInput({ ...base, amount: "10" }), NOW)).toMatchObject({ decision: { outcome: "step_up", reason: "STEP_UP_ABOVE_THRESHOLD" } });
    expect(runLab(draftToInput({ ...base, amount: "30" }), NOW)).toMatchObject({ decision: { reason: "BLOCK_PER_TX_CAP" } });
  });

  it("blocks a zero session TTL and a combined ceiling under the quote", () => {
    const base = draftToInput({ ...defaultDraft("sandbox"), ttlSeconds: "0", amount: "1" });
    expect(runLab(base, NOW)).toMatchObject({ decision: { reason: "BLOCK_SESSION_EXPIRED" } });
    const combined = draftToInput({
      ...defaultDraft("sandbox"),
      amount: "10",
      quotedFee: "0.40",
      estimatedGas: "0.05",
      maxFeeAmount: "1",
      maxGasAmount: "1",
      maxCombinedAmount: "10",
    });
    expect(runLab(combined, NOW)).toMatchObject({ decision: { reason: "BLOCK_COMBINED_CEILING" } });
  });

  it("runs a settled challenge replay and an in-flight serial block on AttemptLedger", () => {
    const input = draftToInput({ ...defaultDraft("sandbox"), amount: "1", scenario: "replay" });
    const result = runLab(input, NOW);
    expect(result).toMatchObject({
      decision: { outcome: "block", reason: "BLOCK_REPLAY" },
      companion: { reason: "BLOCK_ATTEMPT_IN_FLIGHT" },
      mode: "ledger",
    });
    if ("lifecycle" in result) expect(result.lifecycle).toHaveLength(7);
  });
});
