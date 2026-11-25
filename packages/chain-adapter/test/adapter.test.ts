import { readFileSync } from "node:fs";
import { AttemptLedger, examplePolicy, normalizePolicy, policyHash, REFERENCE_CHAINS } from "@vaulthropic/core";
import type { AttemptLedger as Ledger, SpendPolicy } from "@vaulthropic/core";
import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import {
  ADAPTER_CATALOG,
  createBaseAdapter,
  createBaseSepoliaAdapter,
  createCatalogAdapter,
  createMppRailAdapter,
  createSolanaAdapter,
  v1SettlementChains,
} from "../src/index.js";
import type { AdapterHost, QuoteEstimate } from "../src/index.js";

const NOW = 1_700_000_000;
const SIGNER = "0x3333333333333333333333333333333333333333";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const TEST_ASSET = "0x2222222222222222222222222222222222222222";
const TX = `0x${"ab".repeat(32)}`;

function quote(chainId: string, asset: string, principalAmount = 1_000_000n, patch: Partial<QuoteEstimate> = {}): QuoteEstimate {
  return {
    chainId,
    asset,
    principalAmount,
    quotedFeeAmount: 0n,
    estimatedGasAmount: 0n,
    deadlineEpochSec: NOW + 3_600,
    ...patch,
  };
}

function host(ledger: Ledger, policy: SpendPolicy, patch: Partial<AdapterHost> = {}): AdapterHost {
  return {
    ledger,
    policy,
    agentId: "agent-1",
    sessionId: "session-1",
    now: () => NOW,
    ...patch,
  };
}

function evmPolicy(chain: string, environment: SpendPolicy["environment"], limits: SpendPolicy["limits"], asset: string): SpendPolicy {
  return normalizePolicy({
    version: "1",
    policyId: `adapter-${chain.replace(":", "-")}`,
    account: ACCOUNT,
    environment,
    chains: [chain],
    assets: [{ chain, asset, symbol: "USDC", decimals: 6 }],
    limits,
    allowlists: {
      recipients: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
      endpoints: ["https://merchant.example"],
      mcp: [],
    },
    mandates: { requireIntentForAutonomous: true, maxMandateTtlSeconds: 86_400 },
    session: { signer: SIGNER, validUntil: 1_893_456_000, paused: false },
  });
}

const caps = examplePolicy().limits;

describe("chain adapter catalog", () => {
  it("keeps v1 selector chains on Base and Base Sepolia", () => {
    expect(v1SettlementChains()).toEqual(["eip155:8453", "eip155:84532"]);
    expect(ADAPTER_CATALOG.filter((entry) => entry.wave === "v1").map((entry) => entry.adapterId)).toEqual(["base", "base-sepolia"]);
    expect(ADAPTER_CATALOG.find((entry) => entry.adapterId === "ethereum")?.finality).toBe("irreversible");
    const published = JSON.stringify(ADAPTER_CATALOG);
    expect(published).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(published).not.toMatch(/https?:\/\//);
    expect(published.toLowerCase()).not.toMatch(/rpc/);
  });

  it("delegates ceiling checks to evaluateSpend", () => {
    const source = readFileSync(new URL("../src/adapter.ts", import.meta.url), "utf8");
    expect(source).toContain("evaluateSpend");
    expect(source).not.toMatch(/takeRate|maxFeeBps/);
  });
});

describe("Base and Base Sepolia", () => {
  it("allows 1 USDC, reuses the lease, and blocks a second serial attempt", async () => {
    const ledger = new AttemptLedger();
    const policy = examplePolicy();
    const adapter = createBaseSepoliaAdapter(host(ledger, policy));
    ledger.setSignerNonce(policy.session.signer, "4");
    const attemptId = "attempt-base-sepolia-1";
    const asset = policy.assets[0]?.asset ?? "";
    const estimated = await adapter.estimateAndValidate({
      attemptId,
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote(REFERENCE_CHAINS.sandbox.caip2, asset),
    });
    expect(estimated).toEqual({ ok: true });

    const first = await adapter.acquireSequence({
      attemptId,
      chainId: "eip155:84532",
      signerOrAccountRef: policy.session.signer,
      mode: "SERIAL",
    });
    const again = await adapter.acquireSequence({
      attemptId,
      chainId: "eip155:84532",
      signerOrAccountRef: policy.session.signer,
      mode: "SERIAL",
    });
    expect(first).toEqual({ ok: true, lease: { leaseId: "4", expiresAtEpochSec: NOW + 3_600 } });
    expect(again).toEqual(first);
    expect(ledger.get(attemptId)?.attemptCount).toBe(1);
    expect(ledger.get(attemptId)?.status).toBe("CREATED");

    const crowded = await adapter.estimateAndValidate({
      attemptId: "attempt-base-sepolia-2",
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote(REFERENCE_CHAINS.sandbox.caip2, asset),
    });
    expect(crowded).toEqual({ ok: true });
    const blocked = await adapter.acquireSequence({
      attemptId: "attempt-base-sepolia-2",
      chainId: "eip155:84532",
      signerOrAccountRef: policy.session.signer,
      mode: "SERIAL",
    });
    expect(blocked).toEqual({ ok: false, reasonCode: "BLOCK_ATTEMPT_IN_FLIGHT" });
  });

  it("returns BLOCK_NONCE_UNAVAILABLE when the signer cursor is unset", async () => {
    const ledger = new AttemptLedger();
    const policy = examplePolicy();
    const adapter = createBaseSepoliaAdapter(host(ledger, policy));
    const attemptId = "attempt-no-nonce-001";
    const estimated = await adapter.estimateAndValidate({
      attemptId,
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:84532", policy.assets[0]?.asset ?? ""),
    });
    expect(estimated).toEqual({ ok: true });
    const leased = await adapter.acquireSequence({
      attemptId,
      chainId: "eip155:84532",
      signerOrAccountRef: policy.session.signer,
      mode: "SERIAL",
    });
    expect(leased).toEqual({ ok: false, reasonCode: "BLOCK_NONCE_UNAVAILABLE" });
    expect(ledger.get(attemptId)).toBeUndefined();
    expect(ledger.outstanding(policyHash(policy), policy.session.signer)).toBe("0");
  });

  it("records a broadcast hash and releases the reserve when the deadline passes", async () => {
    const ledger = new AttemptLedger();
    const policy = examplePolicy();
    const adapter = createBaseSepoliaAdapter(host(ledger, policy));
    ledger.setSignerNonce(policy.session.signer, "0");
    const attemptId = "attempt-submit-0001";
    const asset = policy.assets[0]?.asset ?? "";
    await adapter.estimateAndValidate({
      attemptId,
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:84532", asset),
    });
    const leased = await adapter.acquireSequence({
      attemptId,
      chainId: "eip155:84532",
      signerOrAccountRef: policy.session.signer,
      mode: "SERIAL",
    });
    if (!leased.ok) throw new Error(leased.reasonCode);
    const unsigned = await adapter.submitAttempt({ attemptId, lease: leased.lease, signedPayloadOrCredential: "signed-payload" });
    expect(unsigned).toEqual({ ok: false, reasonCode: "BLOCK_MALFORMED_REQUEST" });
    expect(ledger.get(attemptId)?.status).toBe("CREATED");

    const submitted = await adapter.submitAttempt({ attemptId, lease: leased.lease, signedPayloadOrCredential: TX });
    expect(submitted).toEqual({ ok: true, txOrPaymentRef: TX });
    expect(ledger.get(attemptId)?.status).toBe("IN_FLIGHT_PENDING");
    const repeated = await adapter.submitAttempt({ attemptId, lease: leased.lease, signedPayloadOrCredential: TX });
    expect(repeated).toEqual({ ok: true, txOrPaymentRef: TX });
    const swapped = await adapter.submitAttempt({ attemptId, lease: leased.lease, signedPayloadOrCredential: `0x${"cd".repeat(32)}` });
    expect(swapped).toEqual({ ok: false, reasonCode: "BLOCK_ATTEMPT_IN_FLIGHT" });

    const pending = await adapter.pollStatus({ attemptId, txOrPaymentRef: TX, lease: leased.lease, nowEpochSec: NOW + 10 });
    expect(pending).toEqual({ state: "IN_FLIGHT_PENDING" });
    const expired = await adapter.pollStatus({ attemptId, txOrPaymentRef: TX, lease: leased.lease, nowEpochSec: NOW + 3_600 });
    expect(expired).toEqual({ state: "EXPIRED_OR_DROPPED", reasonCode: "BLOCK_DEADLINE_EXCEEDED" });
    expect(ledger.outstanding(policyHash(policy), policy.session.signer)).toBe("0");
  });

  it("blocks a combined-ceiling gas spike on Base Sepolia and on Arbitrum through the same check", async () => {
    const limits: SpendPolicy["limits"] = {
      ...caps,
      maxFeeAmount: "1000000",
      maxGasAmount: "1000000",
      maxCombinedAmount: "2000000",
    };
    const spike = quote("eip155:84532", REFERENCE_CHAINS.sandbox.usdc, 1_000_000n, {
      quotedFeeAmount: 100_000n,
      estimatedGasAmount: 1_000_000n,
    });
    const basePolicy = evmPolicy("eip155:84532", "sandbox", limits, REFERENCE_CHAINS.sandbox.usdc);
    const base = createBaseSepoliaAdapter(host(new AttemptLedger(), basePolicy));
    const baseResult = await base.estimateAndValidate({
      attemptId: "attempt-combined-base",
      protocol: "x402",
      recipient: basePolicy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: spike,
    });
    expect(baseResult).toEqual({ ok: false, reasonCode: "BLOCK_COMBINED_CEILING" });

    const arbitrumPolicy = evmPolicy("eip155:42161", "sandbox", limits, TEST_ASSET);
    const arbitrum = createCatalogAdapter("arbitrum", host(new AttemptLedger(), arbitrumPolicy));
    const arbitrumResult = await arbitrum.estimateAndValidate({
      attemptId: "attempt-combined-arb1",
      protocol: "AP2",
      recipient: arbitrumPolicy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:42161", TEST_ASSET, 1_000_000n, { quotedFeeAmount: 100_000n, estimatedGasAmount: 1_000_000n }),
    });
    expect(arbitrumResult).toEqual({ ok: false, reasonCode: "BLOCK_COMBINED_CEILING" });
  });

  it("refuses a chain outside the adapter", async () => {
    const adapter = createBaseAdapter(host(new AttemptLedger(), examplePolicy("mainnet")));
    const refused = await adapter.estimateAndValidate({
      attemptId: "attempt-wrong-chain1",
      protocol: "x402",
      recipient: SIGNER,
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:42161", TEST_ASSET),
    });
    expect(refused).toEqual({ ok: false, reasonCode: "BLOCK_CHAIN_NOT_ALLOWLISTED" });
  });

  it("commits the actual gas on FINALIZED and returns the unused reserve to the epoch", async () => {
    const limits: SpendPolicy["limits"] = {
      perTransaction: "600000",
      perEpoch: "600000",
      epochSeconds: 86_400,
      stepUpAbove: "600000",
      maxGasAmount: "50000",
      maxCombinedAmount: "600000",
    };
    const policy = evmPolicy("eip155:84532", "sandbox", limits, REFERENCE_CHAINS.sandbox.usdc);
    const ledger = new AttemptLedger();
    const adapter = createBaseSepoliaAdapter(host(ledger, policy, {
      readInclusion: async () => ({
        state: "FINALIZED",
        receipt: {
          txOrPaymentRef: TX,
          finalized: true,
          actualPrincipalAmount: 500_000n,
          actualFeeAmount: 0n,
          actualGasAmount: 10_000n,
        },
      }),
    }));
    ledger.setSignerNonce(SIGNER, "0");
    const attemptId = "attempt-actual-gas01";
    const estimated = await adapter.estimateAndValidate({
      attemptId,
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:84532", REFERENCE_CHAINS.sandbox.usdc, 500_000n, { estimatedGasAmount: 50_000n }),
    });
    expect(estimated).toEqual({ ok: true });
    const leased = await adapter.acquireSequence({ attemptId, chainId: "eip155:84532", signerOrAccountRef: SIGNER, mode: "SERIAL" });
    if (!leased.ok) throw new Error(leased.reasonCode);
    await adapter.submitAttempt({ attemptId, lease: leased.lease, signedPayloadOrCredential: TX });
    const finalized = await adapter.pollStatus({ attemptId, txOrPaymentRef: TX, lease: leased.lease, nowEpochSec: NOW + 5 });
    expect(finalized.state).toBe("FINALIZED");
    if (finalized.state === "FINALIZED") expect(finalized.receipt.actualGasAmount).toBe(10_000n);
    expect(ledger.get(attemptId)?.settledAmount).toBe("510000");
    expect(ledger.outstanding(policyHash(policy), SIGNER)).toBe("0");

    const follow = "attempt-actual-gas02";
    await adapter.estimateAndValidate({
      attemptId: follow,
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:84532", REFERENCE_CHAINS.sandbox.usdc, 90_000n),
    });
    const next = await adapter.acquireSequence({ attemptId: follow, chainId: "eip155:84532", signerOrAccountRef: SIGNER, mode: "SERIAL" });
    expect(next.ok).toBe(true);
  });

  it("leaves an in-flight attempt untouched when actuals exceed the reserve", async () => {
    const limits: SpendPolicy["limits"] = { ...caps, maxGasAmount: "50000", maxCombinedAmount: "2000000" };
    const policy = evmPolicy("eip155:84532", "sandbox", limits, REFERENCE_CHAINS.sandbox.usdc);
    const ledger = new AttemptLedger();
    const adapter = createBaseSepoliaAdapter(host(ledger, policy, {
      readInclusion: async () => ({
        state: "FINALIZED",
        receipt: {
          txOrPaymentRef: TX,
          finalized: true,
          actualPrincipalAmount: 1_000_000n,
          actualFeeAmount: 0n,
          actualGasAmount: 60_000n,
        },
      }),
    }));
    ledger.setSignerNonce(SIGNER, "0");
    const attemptId = "attempt-over-actual01";
    await adapter.estimateAndValidate({
      attemptId,
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:84532", REFERENCE_CHAINS.sandbox.usdc, 1_000_000n, { estimatedGasAmount: 50_000n }),
    });
    const leased = await adapter.acquireSequence({ attemptId, chainId: "eip155:84532", signerOrAccountRef: SIGNER, mode: "SERIAL" });
    if (!leased.ok) throw new Error(leased.reasonCode);
    await adapter.submitAttempt({ attemptId, lease: leased.lease, signedPayloadOrCredential: TX });
    const polled = await adapter.pollStatus({ attemptId, txOrPaymentRef: TX, lease: leased.lease, nowEpochSec: NOW + 5 });
    expect(polled).toEqual({ state: "FAILED", reasonCode: "BLOCK_MALFORMED_REQUEST" });
    expect(ledger.get(attemptId)?.status).toBe("IN_FLIGHT_PENDING");
    expect(ledger.outstanding(policyHash(policy), SIGNER)).toBe("1050000");
  });

  it("blocks a new attempt that reuses a settled challenge", async () => {
    const ledger = new AttemptLedger();
    const policy = examplePolicy();
    const adapter = createBaseSepoliaAdapter(host(ledger, policy, {
      readInclusion: async () => ({
        state: "FINALIZED",
        receipt: { txOrPaymentRef: TX, finalized: true, actualPrincipalAmount: 1_000_000n, actualFeeAmount: 0n, actualGasAmount: 0n },
      }),
    }));
    ledger.setSignerNonce(SIGNER, "0");
    const first = "attempt-replay-00001";
    await adapter.estimateAndValidate({
      attemptId: first,
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "challenge-alpha-0001",
      quote: quote("eip155:84532", policy.assets[0]?.asset ?? ""),
    });
    const leased = await adapter.acquireSequence({ attemptId: first, chainId: "eip155:84532", signerOrAccountRef: SIGNER, mode: "SERIAL" });
    if (!leased.ok) throw new Error(leased.reasonCode);
    await adapter.submitAttempt({ attemptId: first, lease: leased.lease, signedPayloadOrCredential: TX });
    await adapter.pollStatus({ attemptId: first, txOrPaymentRef: TX, lease: leased.lease, nowEpochSec: NOW + 5 });

    const second = "attempt-replay-00002";
    await adapter.estimateAndValidate({
      attemptId: second,
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "challenge-alpha-0001",
      quote: quote("eip155:84532", policy.assets[0]?.asset ?? ""),
    });
    const replay = await adapter.acquireSequence({ attemptId: second, chainId: "eip155:84532", signerOrAccountRef: SIGNER, mode: "SERIAL" });
    expect(replay).toEqual({ ok: false, reasonCode: "BLOCK_REPLAY" });
  });

  it("returns step-up until the host has verified the owner factor", async () => {
    const policy = examplePolicy();
    const adapter = createBaseSepoliaAdapter(host(new AttemptLedger(), policy));
    const stepped = await adapter.estimateAndValidate({
      attemptId: "attempt-step-up-0001",
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:84532", policy.assets[0]?.asset ?? "", 10_000_000n),
    });
    expect(stepped).toEqual({ ok: false, reasonCode: "STEP_UP_ABOVE_THRESHOLD" });
  });

  it("maps CONCURRENT_BOUNDED onto the async queue with no numeric cap", async () => {
    const ledger = new AttemptLedger();
    const policy = examplePolicy();
    const adapter = createBaseSepoliaAdapter(host(ledger, policy));
    ledger.setSignerNonce(SIGNER, "0");
    for (const attemptId of ["attempt-async-000001", "attempt-async-000002"]) {
      await adapter.estimateAndValidate({
        attemptId,
        protocol: "mcp",
        recipient: policy.allowlists.recipients[0] ?? "",
        endpointOrMandateRef: "https://merchant.example/quote",
        quote: quote("eip155:84532", policy.assets[0]?.asset ?? ""),
      });
      const leased = await adapter.acquireSequence({
        attemptId,
        chainId: "eip155:84532",
        signerOrAccountRef: SIGNER,
        mode: "CONCURRENT_BOUNDED",
      });
      expect(leased.ok).toBe(true);
      expect(ledger.get(attemptId)?.queue).toBe("async");
    }
    expect(ledger.outstanding(policyHash(policy), SIGNER)).toBe("2000000");
  });

  it("asks the host transport to broadcast when the payload is not already a settlement ref", async () => {
    const ledger = new AttemptLedger();
    const policy = examplePolicy();
    const calls: string[] = [];
    const adapter = createBaseSepoliaAdapter(host(ledger, policy, {
      broadcast: async (input) => {
        calls.push(input.signedPayloadOrCredential);
        return TX;
      },
    }));
    ledger.setSignerNonce(SIGNER, "0");
    const attemptId = "attempt-broadcast-01";
    await adapter.estimateAndValidate({
      attemptId,
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:84532", policy.assets[0]?.asset ?? ""),
    });
    const leased = await adapter.acquireSequence({ attemptId, chainId: "eip155:84532", signerOrAccountRef: SIGNER, mode: "SERIAL" });
    if (!leased.ok) throw new Error(leased.reasonCode);
    const submitted = await adapter.submitAttempt({ attemptId, lease: leased.lease, signedPayloadOrCredential: "raw-signed-payload" });
    expect(submitted).toEqual({ ok: true, txOrPaymentRef: TX });
    expect(calls).toEqual(["raw-signed-payload"]);
    expect(ledger.get(attemptId)?.status).toBe("IN_FLIGHT_PENDING");
  });

  it("releases a created attempt when the host drops the lease", async () => {
    const ledger = new AttemptLedger();
    const policy = examplePolicy();
    const adapter = createBaseSepoliaAdapter(host(ledger, policy));
    ledger.setSignerNonce(SIGNER, "3");
    const attemptId = "attempt-release-0001";
    await adapter.estimateAndValidate({
      attemptId,
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:84532", policy.assets[0]?.asset ?? ""),
    });
    const leased = await adapter.acquireSequence({ attemptId, chainId: "eip155:84532", signerOrAccountRef: SIGNER, mode: "SERIAL" });
    if (!leased.ok) throw new Error(leased.reasonCode);
    await adapter.releaseSequence(leased.lease);
    expect(ledger.get(attemptId)?.status).toBe("FAILED");
    expect(ledger.get(attemptId)?.nonceReusable).toBe(true);
    expect(ledger.outstanding(policyHash(policy), SIGNER)).toBe("0");
  });
});

describe("Solana blockhash lease", () => {
  it("blocks without a blockhash, then expires and lets the same attempt reserve again", async () => {
    const policy = normalizePolicy({
      version: "1",
      policyId: "adapter-solana",
      account: "agent-account",
      environment: "sandbox",
      chains: ["solana:devnet"],
      assets: [{ chain: "solana:devnet", asset: "usdc-solana", symbol: "USDC", decimals: 6 }],
      limits: caps,
      allowlists: { recipients: ["merchant-1"], endpoints: ["https://merchant.example"], mcp: [] },
      mandates: { requireIntentForAutonomous: true, maxMandateTtlSeconds: 86_400 },
      session: { signer: "agent-session", validUntil: 1_893_456_000, paused: false },
    });
    const ledger = new AttemptLedger();
    let clock = NOW;
    let leased: { blockhash: string; expiresAtEpochSec: number } | null = null;
    const adapter = createSolanaAdapter(host(ledger, policy, {
      now: () => clock,
      recentBlockhash: () => leased,
    }), { supportedChains: ["solana:devnet"] });
    const attemptId = "attempt-solana-0001";
    const estimated = await adapter.estimateAndValidate({
      attemptId,
      protocol: "x402",
      recipient: "merchant-1",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("solana:devnet", "usdc-solana", 1_000_000n, { deadlineEpochSec: NOW + 90 }),
    });
    expect(estimated).toEqual({ ok: true });
    const missing = await adapter.acquireSequence({
      attemptId,
      chainId: "solana:devnet",
      signerOrAccountRef: "agent-session",
      mode: "SERIAL",
    });
    expect(missing).toEqual({ ok: false, reasonCode: "BLOCK_NONCE_UNAVAILABLE" });
    expect(ledger.outstanding(policyHash(policy), "agent-session")).toBe("0");

    leased = { blockhash: "blockhash-window-0001", expiresAtEpochSec: NOW + 30 };
    const acquired = await adapter.acquireSequence({
      attemptId,
      chainId: "solana:devnet",
      signerOrAccountRef: "agent-session",
      mode: "SERIAL",
    });
    expect(acquired).toEqual({ ok: true, lease: { leaseId: "blockhash-window-0001", expiresAtEpochSec: NOW + 30 } });
    if (!acquired.ok) return;
    const expired = await adapter.pollStatus({
      attemptId,
      txOrPaymentRef: "",
      lease: acquired.lease,
      nowEpochSec: NOW + 30,
    });
    expect(expired).toEqual({ state: "EXPIRED_OR_DROPPED", reasonCode: "BLOCK_DEADLINE_EXCEEDED" });
    expect(ledger.outstanding(policyHash(policy), "agent-session")).toBe("0");

    clock = NOW + 31;
    leased = { blockhash: "blockhash-window-0002", expiresAtEpochSec: NOW + 80 };
    const retry = await adapter.acquireSequence({
      attemptId,
      chainId: "solana:devnet",
      signerOrAccountRef: "agent-session",
      mode: "SERIAL",
    });
    expect(retry.ok).toBe(true);
    expect(ledger.get(attemptId)?.attemptCount).toBe(2);
    expect(ledger.outstanding(policyHash(policy), "agent-session")).toBe("1000000");
  });
});

describe("MPP rail", () => {
  it("hashes a credential, rejects a second payload in flight, and replays a settled challenge", async () => {
    const policy = normalizePolicy({
      version: "1",
      policyId: "adapter-mpp-tempo",
      account: "tempo-account",
      environment: "sandbox",
      chains: ["mpp:tempo"],
      assets: [{ chain: "mpp:tempo", asset: "usdc", symbol: "USDC", decimals: 6 }],
      limits: caps,
      allowlists: { recipients: ["merchant-1"], endpoints: [], mcp: [] },
      mandates: { requireIntentForAutonomous: true, maxMandateTtlSeconds: 86_400 },
      session: { signer: "tempo-session", validUntil: 1_893_456_000, paused: false },
    });
    const ledger = new AttemptLedger();
    let broadcasts = 0;
    const adapter = createMppRailAdapter(host(ledger, policy, {
      broadcast: async () => {
        broadcasts += 1;
        return TX;
      },
      readInclusion: async (input) => ({
        state: "FINALIZED",
        receipt: {
          txOrPaymentRef: input.txOrPaymentRef,
          finalized: true,
          actualPrincipalAmount: 1_000_000n,
          actualFeeAmount: 0n,
          actualGasAmount: 0n,
        },
      }),
    }));
    const attemptId = "mpp-attempt-00001";
    const credential = "credential-body-one";
    const estimated = await adapter.estimateAndValidate({
      attemptId,
      protocol: "MPP",
      recipient: "merchant-1",
      endpointOrMandateRef: "challenge-tempo-01",
      quote: quote("mpp:tempo", "usdc"),
    });
    expect(estimated).toEqual({ ok: true });
    const leased = await adapter.acquireSequence({
      attemptId,
      chainId: "mpp:tempo",
      signerOrAccountRef: "tempo-session",
      mode: "SERIAL",
    });
    if (!leased.ok) throw new Error(leased.reasonCode);
    const submitted = await adapter.submitAttempt({ attemptId, lease: leased.lease, signedPayloadOrCredential: credential });
    expect(submitted).toEqual({ ok: true, txOrPaymentRef: keccak256(toBytes(credential)) });
    expect(broadcasts).toBe(0);
    const conflict = await adapter.submitAttempt({ attemptId, lease: leased.lease, signedPayloadOrCredential: "credential-body-two" });
    expect(conflict).toEqual({ ok: false, reasonCode: "BLOCK_ATTEMPT_IN_FLIGHT" });

    const finalized = await adapter.pollStatus({
      attemptId,
      txOrPaymentRef: keccak256(toBytes(credential)),
      lease: leased.lease,
      nowEpochSec: NOW + 5,
    });
    expect(finalized.state).toBe("FINALIZED");

    const second = "mpp-attempt-00002";
    await adapter.estimateAndValidate({
      attemptId: second,
      protocol: "x402",
      recipient: "merchant-1",
      endpointOrMandateRef: "challenge-tempo-01",
      quote: quote("mpp:tempo", "usdc"),
    });
    const replay = await adapter.acquireSequence({
      attemptId: second,
      chainId: "mpp:tempo",
      signerOrAccountRef: "tempo-session",
      mode: "SERIAL",
    });
    expect(replay).toEqual({ ok: false, reasonCode: "BLOCK_REPLAY" });
  });
});

describe("Ethereum L1 adapter", () => {
  it("waits on irreversible finality", async () => {
    const policy = evmPolicy("eip155:1", "sandbox", caps, TEST_ASSET);
    const ledger = new AttemptLedger();
    const adapter = createCatalogAdapter("ethereum", host(ledger, policy));
    expect(adapter.finality).toBe("irreversible");
    expect(adapter.supportedChains).toEqual(["eip155:1"]);
    ledger.setSignerNonce(SIGNER, "0");
    const attemptId = "attempt-ethereum-001";
    await adapter.estimateAndValidate({
      attemptId,
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:1", TEST_ASSET),
    });
    const leased = await adapter.acquireSequence({ attemptId, chainId: "eip155:1", signerOrAccountRef: SIGNER, mode: "SERIAL" });
    expect(leased.ok).toBe(true);
    expect(ledger.get(attemptId)?.finality).toBe("irreversible");
  });
});

describe("fee ceiling delegation", () => {
  it("accepts a quote inside maxFeeBps and blocks one basis point over it", async () => {
    const limits: SpendPolicy["limits"] = { ...caps, maxFeeAmount: "1000000", maxFeeBps: 100 };
    const policy = evmPolicy("eip155:84532", "sandbox", limits, REFERENCE_CHAINS.sandbox.usdc);
    const adapter = createBaseSepoliaAdapter(host(new AttemptLedger(), policy));
    const inside = await adapter.estimateAndValidate({
      attemptId: "attempt-fee-bps-0001",
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:84532", REFERENCE_CHAINS.sandbox.usdc, 1_000_000n, { quotedFeeAmount: 10_000n }),
    });
    const over = await adapter.estimateAndValidate({
      attemptId: "attempt-fee-bps-0002",
      protocol: "x402",
      recipient: policy.allowlists.recipients[0] ?? "",
      endpointOrMandateRef: "https://merchant.example/quote",
      quote: quote("eip155:84532", REFERENCE_CHAINS.sandbox.usdc, 1_000_000n, { quotedFeeAmount: 10_001n }),
    });
    expect(inside).toEqual({ ok: true });
    expect(over).toEqual({ ok: false, reasonCode: "BLOCK_FEE_CEILING" });
  });
});
