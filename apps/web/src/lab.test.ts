import { describe, expect, it } from "vitest";
import { runLab, usdcToMinor } from "./lab.js";

const NOW = 1_700_000_000;
const RECIPIENT = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

describe("console lab", () => {
  it("converts USDC display amounts to 6-decimal minor units", () => {
    expect(usdcToMinor("1")).toBe("1000000");
    expect(usdcToMinor("0.5")).toBe("500000");
    expect(() => usdcToMinor("1.1234567")).toThrow();
  });

  it("allows, steps up, and blocks through each protocol adapter", () => {
    const base = { environment: "sandbox" as const, recipient: RECIPIENT, endpoint: "https://merchant.example/quote" };
    for (const protocol of ["x402", "ap2", "mpp", "mcp"] as const) {
      expect(runLab({ ...base, protocol, amountUsdc: "1" }, NOW)).toMatchObject({ decision: { outcome: "allow" } });
      expect(runLab({ ...base, protocol, amountUsdc: "10" }, NOW)).toMatchObject({ decision: { outcome: "step_up" } });
      expect(runLab({ ...base, protocol, amountUsdc: "30" }, NOW)).toMatchObject({ decision: { reason: "BLOCK_PER_TX_CAP" } });
    }
    expect(runLab({ ...base, protocol: "x402", amountUsdc: "1", recipient: "0x5555555555555555555555555555555555555555" }, NOW)).toMatchObject({
      decision: { reason: "BLOCK_RECIPIENT_NOT_ALLOWLISTED" },
    });
  });

  it("labels an AP2 verdict as a presence check and a replay as a discarded simulation", () => {
    const base = { environment: "sandbox" as const, recipient: RECIPIENT, endpoint: "https://merchant.example/quote", amountUsdc: "1" };
    const ap2 = runLab({ ...base, protocol: "ap2" }, NOW);
    expect(ap2).toMatchObject({ protocol: "ap2", mode: "preview" });
    if ("labNotices" in ap2) {
      expect(ap2.labNotices.join(" ")).toContain("Presence check only");
      expect(ap2.labNotices.join(" ")).toContain("not SD-JWT");
      expect(ap2.labNotices.join(" ")).toContain("did not open a ledger");
    }
    const replay = runLab({ ...base, protocol: "x402", scenario: "replay" }, NOW);
    expect(replay).toMatchObject({ mode: "ledger", decision: { reason: "BLOCK_REPLAY" } });
    if ("labNotices" in replay && "mathNote" in replay) {
      expect(replay.labNotices.join(" ")).toContain("synthetic");
      expect(replay.mathNote).toContain("synthetic");
      expect(replay.lifecycle.map((step) => step.detail).join(" ")).toContain("synthetic");
      expect(replay.labNotices.join(" ")).not.toContain("Presence check only");
    }
  });
});
