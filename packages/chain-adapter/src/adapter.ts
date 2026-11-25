import { keccak256, toBytes } from "viem";
import { evaluateSpend } from "@vaulthropic/core";
import type { AttemptLedger, AttemptRecord, AttemptStatus, EpochUsage, FinalityTier, PaymentIntent, Protocol, QueueMode, ReasonCode, SpendPolicy } from "@vaulthropic/core";
import { canTransition } from "@vaulthropic/core";
import { normalizeAdapterProtocol } from "./protocol.js";
import type {
  AdapterPoll,
  ChainAdapter,
  ExecutionReceipt,
  InclusionReport,
  QuoteEstimate,
  SequenceLease,
  SequenceMode,
  SolanaBlockhashSource,
} from "./types.js";

const RELEASED = new Set<AttemptStatus>(["DROPPED", "REVERTED", "EXPIRED_OR_DROPPED", "FAILED"]);

export type RailKind = "evm" | "solana" | "mpp-rail";

export type AdapterHost = {
  ledger: AttemptLedger;
  policy: SpendPolicy;
  agentId: string;
  sessionId: string;
  now: () => number;
  /** Omitted means irreversible. Fast inclusion commits at INCLUDED_UNFINALIZED. */
  finality?: FinalityTier;
  /** Set only after the owner factor has been verified. Otherwise a step-up stays STEP_UP_ABOVE_THRESHOLD. */
  stepUpSatisfied?: boolean;
  chainUsage?: EpochUsage | (() => EpochUsage);
  /**
   * Operator transport. The public package does not embed an RPC URL.
   * When this is omitted, submitAttempt accepts an already-broadcast settlement ref and does not send a transaction.
   */
  broadcast?: (input: {
    attemptId: string;
    chainId: string;
    signedPayloadOrCredential: string;
    lease: SequenceLease;
  }) => Promise<string>;
  /** When omitted, pollStatus reports the ledger and expires a lease whose window has ended. */
  readInclusion?: (input: { attemptId: string; chainId: string; txOrPaymentRef: string }) => Promise<InclusionReport>;
  /** Solana only. A missing source, or a null lease, is BLOCK_NONCE_UNAVAILABLE. */
  recentBlockhash?: SolanaBlockhashSource;
};

type Prepared = {
  protocol: Protocol;
  recipient: string;
  endpointOrMandateRef: string;
  quote: QuoteEstimate;
};

type RailConfig = {
  adapterId: string;
  supportedChains: readonly string[];
  kind: RailKind;
  host: AdapterHost;
  protocols?: readonly Protocol[];
};

export function createRailAdapter(config: RailConfig): ChainAdapter {
  const prepared = new Map<string, Prepared>();
  const leases = new Map<string, SequenceLease>();
  const receipts = new Map<string, ExecutionReceipt>();
  const finality = config.host.finality ?? "irreversible";

  return {
    adapterId: config.adapterId,
    supportedChains: config.supportedChains,
    finality,

    async estimateAndValidate(params) {
      const attemptId = normalizeAttemptId(params.attemptId);
      if (!isIdempotencyKey(attemptId)) return block("BLOCK_MALFORMED_REQUEST");
      const protocol = normalizeAdapterProtocol(params.protocol);
      if (!protocol) return block("BLOCK_MALFORMED_REQUEST");
      if (config.protocols && !config.protocols.includes(protocol)) return block("BLOCK_MALFORMED_REQUEST");
      if (!config.supportedChains.includes(params.quote.chainId)) return block("BLOCK_CHAIN_NOT_ALLOWLISTED");
      if (!validQuote(params.quote) || params.recipient.trim() === "" || params.endpointOrMandateRef.trim() === "") {
        return block("BLOCK_MALFORMED_REQUEST");
      }
      if (config.kind === "mpp-rail" && !referenceId(params.endpointOrMandateRef)) return block("BLOCK_MALFORMED_REQUEST");

      const next: Prepared = {
        protocol,
        recipient: params.recipient,
        endpointOrMandateRef: params.endpointOrMandateRef,
        quote: params.quote,
      };
      const open = config.host.ledger.get(attemptId);
      if (open && !RELEASED.has(open.status)) {
        const prior = prepared.get(attemptId);
        if (prior && !samePrepared(prior, next)) return block("BLOCK_ATTEMPT_IN_FLIGHT");
        if (!prior && !quoteMatchesRecord(open, next)) return block("BLOCK_ATTEMPT_IN_FLIGHT");
        prepared.set(attemptId, next);
        return { ok: true };
      }

      const refs = intentRefs(config.kind, protocol, params.endpointOrMandateRef);
      const decision = evaluateSpend({
        policy: config.host.policy,
        usage: usageOf(config.host),
        stepUpSatisfied: config.host.stepUpSatisfied,
        request: {
          protocol,
          environment: config.host.policy.environment,
          chain: params.quote.chainId,
          asset: params.quote.asset,
          recipient: params.recipient,
          amount: params.quote.principalAmount.toString(),
          now: config.host.now(),
          ...(refs.endpoint ? { endpoint: refs.endpoint } : {}),
          ...(params.quote.quotedFeeAmount > 0n ? { quotedFeeAmount: params.quote.quotedFeeAmount.toString() } : {}),
          ...(params.quote.estimatedGasAmount > 0n ? { maxGasFee: params.quote.estimatedGasAmount.toString() } : {}),
        },
      });
      if (decision.outcome !== "allow") {
        prepared.delete(attemptId);
        return block(decision.reason);
      }
      prepared.set(attemptId, next);
      return { ok: true };
    },

    async acquireSequence(params) {
      const attemptId = normalizeAttemptId(params.attemptId);
      if (!isIdempotencyKey(attemptId)) return block("BLOCK_MALFORMED_REQUEST");
      if (!config.supportedChains.includes(params.chainId)) return block("BLOCK_CHAIN_NOT_ALLOWLISTED");
      const queue = queueMode(params.mode);
      if (!queue) return block("BLOCK_MALFORMED_REQUEST");

      const open = config.host.ledger.get(attemptId);
      if (open && !RELEASED.has(open.status)) {
        if (open.chain !== params.chainId) return block("BLOCK_MALFORMED_REQUEST");
        const existing = rememberedLease(config.kind, attemptId, open, leases);
        if (!existing) return block("BLOCK_NONCE_UNAVAILABLE");
        return { ok: true, lease: existing };
      }

      const quote = prepared.get(attemptId);
      if (!quote || quote.quote.chainId !== params.chainId) return block("BLOCK_MALFORMED_REQUEST");

      const now = config.host.now();
      let blockhash: string | undefined;
      let blockhashExpiresAt: number | undefined;
      if (config.kind === "solana") {
        const leased = await readBlockhash(config.host.recentBlockhash, { attemptId, chainId: params.chainId, nowEpochSec: now });
        if (!leased) return block("BLOCK_NONCE_UNAVAILABLE");
        blockhash = leased.blockhash;
        blockhashExpiresAt = leased.expiresAtEpochSec;
      }

      const intent: PaymentIntent = {
        idempotencyKey: attemptId,
        agentId: config.host.agentId,
        sessionId: config.host.sessionId,
        requestIntentId: attemptId,
        protocol: quote.protocol,
        environment: config.host.policy.environment,
        chain: params.chainId,
        asset: quote.quote.asset,
        recipient: quote.recipient,
        amount: quote.quote.principalAmount.toString(),
        now,
        deadline: quote.quote.deadlineEpochSec,
        signer: params.signerOrAccountRef,
        finality,
        queue,
        stepUpSatisfied: config.host.stepUpSatisfied,
        ...intentRefs(config.kind, quote.protocol, quote.endpointOrMandateRef),
        ...(quote.quote.quotedFeeAmount > 0n ? { quotedFeeAmount: quote.quote.quotedFeeAmount.toString() } : {}),
        ...(quote.quote.estimatedGasAmount > 0n ? { maxGasFee: quote.quote.estimatedGasAmount.toString() } : {}),
        ...(blockhashExpiresAt === undefined ? {} : { blockhashExpiresAt }),
      };
      const started = config.host.ledger.begin({ policy: config.host.policy, intent, chainUsage: usageOf(config.host) });
      if (!started.reserved || !started.record) return block(started.decision.reason);

      const lease = leaseFor(config.kind, started.record, blockhash, blockhashExpiresAt);
      if (!lease) {
        config.host.ledger.observe(started.record.idempotencyKey, { status: "FAILED", now });
        return block("BLOCK_NONCE_UNAVAILABLE");
      }
      leases.set(attemptId, lease);
      return { ok: true, lease };
    },

    async submitAttempt(params) {
      const attemptId = normalizeAttemptId(params.attemptId);
      const record = config.host.ledger.get(attemptId);
      if (!record) return block("BLOCK_MALFORMED_REQUEST");
      const lease = leases.get(attemptId);
      if (!lease || lease.leaseId !== params.lease.leaseId || lease.expiresAtEpochSec !== params.lease.expiresAtEpochSec) {
        return block("BLOCK_NONCE_UNAVAILABLE");
      }
      const now = config.host.now();
      if (isPreInclusion(record.status) && (now >= lease.expiresAtEpochSec || now >= record.deadline)) {
        config.host.ledger.observe(attemptId, { status: "EXPIRED_OR_DROPPED", now, reason: "BLOCK_DEADLINE_EXCEEDED" });
        return block("BLOCK_DEADLINE_EXCEEDED");
      }
      if (params.signedPayloadOrCredential.trim() === "") return block("BLOCK_MALFORMED_REQUEST");

      const ref = await settlementRef(config, record, params.signedPayloadOrCredential, lease);
      if (!ref.ok) return ref;
      if (record.txHash && record.txHash !== ref.txOrPaymentRef) {
        return block(record.settled || record.status === "FINALIZED" ? "BLOCK_REPLAY" : "BLOCK_ATTEMPT_IN_FLIGHT");
      }
      if (record.txHash === ref.txOrPaymentRef && record.status !== "CREATED") {
        return { ok: true, txOrPaymentRef: record.txHash };
      }
      if (record.status !== "CREATED") return block("BLOCK_ATTEMPT_IN_FLIGHT");

      const observed = config.host.ledger.observe(attemptId, { status: "IN_FLIGHT_PENDING", now, txHash: ref.txOrPaymentRef });
      if (!observed.accepted || !observed.record?.txHash) return block(observed.reason);
      return { ok: true, txOrPaymentRef: observed.record.txHash };
    },

    async pollStatus(params) {
      const attemptId = normalizeAttemptId(params.attemptId);
      const now = params.nowEpochSec;
      if (!Number.isInteger(now) || now < 0) return { state: "FAILED", reasonCode: "BLOCK_MALFORMED_REQUEST" };
      config.host.ledger.expireDue(now);
      const loaded = config.host.ledger.get(attemptId);
      if (!loaded) return { state: "FAILED", reasonCode: "BLOCK_MALFORMED_REQUEST" };

      const supplied = asSettlementRef(params.txOrPaymentRef);
      if (loaded.txHash && supplied && supplied !== loaded.txHash) {
        return { state: "FAILED", reasonCode: "BLOCK_MALFORMED_REQUEST" };
      }
      if (loaded.status === "EXPIRED_OR_DROPPED") return expired(loaded.reason);

      if (isPreInclusion(loaded.status) && (now >= params.lease.expiresAtEpochSec || now >= loaded.deadline)) {
        config.host.ledger.observe(attemptId, {
          status: "EXPIRED_OR_DROPPED",
          now,
          reason: "BLOCK_DEADLINE_EXCEEDED",
          ...(loaded.txHash ? { txHash: loaded.txHash } : {}),
        });
      }

      const current = config.host.ledger.get(attemptId) ?? loaded;
      if (current.status === "EXPIRED_OR_DROPPED") return expired(current.reason);
      if (!current.txHash || !config.host.readInclusion || !readerCanAdvance(current.status)) return viewPoll(current, receipts);

      try {
        const report = await config.host.readInclusion({ attemptId, chainId: current.chain, txOrPaymentRef: current.txHash });
        const advanced = applyReport(config.host.ledger, receipts, attemptId, current, report, now);
        return advanced ?? viewPoll(config.host.ledger.get(attemptId) ?? current, receipts);
      } catch {
        return { state: "FAILED", reasonCode: "BLOCK_MALFORMED_REQUEST" };
      }
    },

    async releaseSequence(lease) {
      const attemptId = openAttemptForLease(leases, config.host.ledger, lease);
      if (!attemptId) return;
      const record = config.host.ledger.get(attemptId);
      if (!record || !isPreInclusion(record.status)) return;
      const now = config.host.now();
      if (record.status === "CREATED") {
        config.host.ledger.observe(attemptId, { status: "FAILED", now });
        return;
      }
      config.host.ledger.observe(attemptId, {
        status: "DROPPED",
        now,
        ...(record.txHash ? { txHash: record.txHash } : {}),
      });
    },
  };
}

function block(reasonCode: ReasonCode): { ok: false; reasonCode: ReasonCode } {
  return { ok: false, reasonCode };
}

function expired(reason: ReasonCode): AdapterPoll {
  return { state: "EXPIRED_OR_DROPPED", reasonCode: reason === "BLOCK_NONCE_UNAVAILABLE" ? reason : "BLOCK_DEADLINE_EXCEEDED" };
}

function usageOf(host: AdapterHost): EpochUsage {
  const usage = typeof host.chainUsage === "function" ? host.chainUsage() : host.chainUsage;
  return usage ?? { spent: "0", windowStartedAt: host.now() };
}

function queueMode(mode: SequenceMode): QueueMode | undefined {
  if (mode === "SERIAL") return "serial";
  if (mode === "CONCURRENT_BOUNDED") return "async";
  return undefined;
}

function validQuote(quote: QuoteEstimate): boolean {
  if (!quote.chainId || /\s/.test(quote.chainId) || quote.asset.trim() === "") return false;
  if (typeof quote.principalAmount !== "bigint" || typeof quote.quotedFeeAmount !== "bigint" || typeof quote.estimatedGasAmount !== "bigint") {
    return false;
  }
  if (quote.principalAmount <= 0n || quote.quotedFeeAmount < 0n || quote.estimatedGasAmount < 0n) return false;
  return Number.isInteger(quote.deadlineEpochSec) && quote.deadlineEpochSec >= 0;
}

function samePrepared(left: Prepared, right: Prepared): boolean {
  return (
    left.protocol === right.protocol &&
    left.recipient === right.recipient &&
    left.endpointOrMandateRef === right.endpointOrMandateRef &&
    left.quote.chainId === right.quote.chainId &&
    left.quote.asset === right.quote.asset &&
    left.quote.principalAmount === right.quote.principalAmount &&
    left.quote.quotedFeeAmount === right.quote.quotedFeeAmount &&
    left.quote.estimatedGasAmount === right.quote.estimatedGasAmount &&
    left.quote.deadlineEpochSec === right.quote.deadlineEpochSec
  );
}

function quoteMatchesRecord(record: AttemptRecord, next: Prepared): boolean {
  return (
    record.protocol === next.protocol &&
    record.chain === next.quote.chainId &&
    record.principal === next.quote.principalAmount.toString() &&
    record.quotedFeeAmount === next.quote.quotedFeeAmount.toString() &&
    record.maxGasFee === next.quote.estimatedGasAmount.toString() &&
    record.deadline === next.quote.deadlineEpochSec
  );
}

function intentRefs(kind: RailKind, protocol: Protocol, ref: string): Pick<PaymentIntent, "endpoint" | "challengeId" | "mandateId"> {
  if (kind === "mpp-rail") {
    const challengeId = referenceId(ref);
    return challengeId ? { challengeId } : {};
  }
  if (ref.includes("://")) return { endpoint: ref };
  const id = referenceId(ref);
  if (!id) return { endpoint: ref };
  if (protocol === "ap2") return { mandateId: id };
  return { challengeId: id };
}

async function readBlockhash(
  source: SolanaBlockhashSource | undefined,
  input: { attemptId: string; chainId: string; nowEpochSec: number },
): Promise<{ blockhash: string; expiresAtEpochSec: number } | undefined> {
  if (!source) return undefined;
  const leased = await source(input);
  if (!leased || leased.blockhash.trim() === "" || !Number.isInteger(leased.expiresAtEpochSec)) return undefined;
  return { blockhash: leased.blockhash.trim(), expiresAtEpochSec: leased.expiresAtEpochSec };
}

function leaseFor(kind: RailKind, record: AttemptRecord, blockhash: string | undefined, blockhashExpiresAt: number | undefined): SequenceLease | undefined {
  if (kind === "solana") {
    if (!blockhash || blockhashExpiresAt === undefined) return undefined;
    return { leaseId: blockhash, expiresAtEpochSec: blockhashExpiresAt };
  }
  if (kind === "evm") {
    if (record.nonce === undefined) return undefined;
    return { leaseId: record.nonce, expiresAtEpochSec: record.deadline };
  }
  return { leaseId: `mpp:${record.idempotencyKey}`, expiresAtEpochSec: record.deadline };
}

function rememberedLease(kind: RailKind, attemptId: string, record: AttemptRecord, leases: Map<string, SequenceLease>): SequenceLease | undefined {
  const stored = leases.get(attemptId);
  if (stored) return stored;
  const rebuilt = leaseFor(kind, record, undefined, undefined);
  if (!rebuilt) return undefined;
  leases.set(attemptId, rebuilt);
  return rebuilt;
}

async function settlementRef(
  config: RailConfig,
  record: AttemptRecord,
  payload: string,
  lease: SequenceLease,
): Promise<{ ok: true; txOrPaymentRef: string } | { ok: false; reasonCode: ReasonCode }> {
  const direct = asSettlementRef(payload);
  if (direct) return { ok: true, txOrPaymentRef: direct };
  if (config.kind === "mpp-rail") return { ok: true, txOrPaymentRef: keccak256(toBytes(payload)) };
  if (!config.host.broadcast) return block("BLOCK_MALFORMED_REQUEST");
  try {
    const produced = await config.host.broadcast({
      attemptId: record.idempotencyKey,
      chainId: record.chain,
      signedPayloadOrCredential: payload,
      lease,
    });
    const parsed = asSettlementRef(produced);
    if (!parsed) return block("BLOCK_MALFORMED_REQUEST");
    return { ok: true, txOrPaymentRef: parsed };
  } catch {
    return block("BLOCK_MALFORMED_REQUEST");
  }
}

function applyReport(
  ledger: AttemptLedger,
  receipts: Map<string, ExecutionReceipt>,
  attemptId: string,
  record: AttemptRecord,
  report: InclusionReport,
  now: number,
): AdapterPoll | undefined {
  const target = report.state === "IN_FLIGHT_PENDING" ? undefined : report.state;
  if (!target || !record.txHash) return { state: "IN_FLIGHT_PENDING" };
  if ("receipt" in report && report.receipt && !withinReserve(record, report.receipt)) {
    return { state: "FAILED", reasonCode: "BLOCK_MALFORMED_REQUEST" };
  }
  const steps = stepsToward(record.status, target);
  if (!steps) return { state: "FAILED", reasonCode: "BLOCK_MALFORMED_REQUEST" };
  const actuals = "receipt" in report ? actualFields(report.receipt) : undefined;
  for (const status of steps) {
    const observed = ledger.observe(attemptId, {
      status,
      now,
      txHash: record.txHash,
      ...(status === "REVERTED" || status === "FAILED" || status === "DROPPED" ? reasonField(report) : {}),
      ...(status === "INCLUDED_UNFINALIZED" || status === "FINALIZED" ? actuals ?? {} : {}),
    });
    if (!observed.accepted) return { state: "FAILED", reasonCode: observed.reason };
  }
  const next = ledger.get(attemptId);
  if (!next) return { state: "FAILED", reasonCode: "BLOCK_MALFORMED_REQUEST" };
  if ("receipt" in report && report.receipt) receipts.set(attemptId, withFinality(report.receipt, next));
  return viewPoll(next, receipts);
}

function reasonField(report: InclusionReport): { reason?: ReasonCode } {
  if ("reasonCode" in report && report.reasonCode) return { reason: report.reasonCode };
  return {};
}

function withinReserve(record: AttemptRecord, receipt: ExecutionReceipt): boolean {
  try {
    return (
      receipt.actualPrincipalAmount <= BigInt(record.principal) &&
      receipt.actualFeeAmount <= BigInt(record.quotedFeeAmount) &&
      receipt.actualGasAmount <= BigInt(record.maxGasFee)
    );
  } catch {
    return false;
  }
}

function actualFields(receipt: ExecutionReceipt | undefined): { actualAmount: string; actualFee: string; actualGas: string } | undefined {
  if (!receipt) return undefined;
  return {
    actualAmount: receipt.actualPrincipalAmount.toString(),
    actualFee: receipt.actualFeeAmount.toString(),
    actualGas: receipt.actualGasAmount.toString(),
  };
}

function stepsToward(from: AttemptStatus, to: AttemptStatus): AttemptStatus[] | undefined {
  if (from === to) return [];
  if (to === "FINALIZED") {
    if (from === "IN_FLIGHT_PENDING" || from === "REPLACED") {
      const first = from === "REPLACED" ? (["IN_FLIGHT_PENDING"] as const) : [];
      return [...first, "INCLUDED_UNFINALIZED", "FINALIZED"];
    }
    if (from === "INCLUDED_UNFINALIZED") return ["FINALIZED"];
  }
  if (to === "INCLUDED_UNFINALIZED") {
    if (from === "REPLACED") return ["IN_FLIGHT_PENDING", "INCLUDED_UNFINALIZED"];
    if (from === "IN_FLIGHT_PENDING") return ["INCLUDED_UNFINALIZED"];
  }
  if ((to === "REVERTED" || to === "FAILED" || to === "DROPPED") && canTransition(from, to)) return [to];
  return undefined;
}

function viewPoll(record: AttemptRecord, receipts: Map<string, ExecutionReceipt>): AdapterPoll {
  if (record.status === "FINALIZED") return { state: "FINALIZED", receipt: receiptFor(record, receipts, true) };
  if (record.status === "INCLUDED_UNFINALIZED") return { state: "INCLUDED_UNFINALIZED", receipt: receiptFor(record, receipts, false) };
  if (record.status === "REVERTED" || record.status === "FAILED" || record.status === "DROPPED") {
    return { state: record.status, reasonCode: record.reason };
  }
  if (record.status === "EXPIRED_OR_DROPPED") return expired(record.reason);
  if (record.status === "REPLACED") return { state: "REPLACED" };
  if (record.status === "IN_FLIGHT_PENDING") return { state: "IN_FLIGHT_PENDING" };
  return { state: "CREATED" };
}

function receiptFor(record: AttemptRecord, receipts: Map<string, ExecutionReceipt>, finalized: boolean): ExecutionReceipt {
  const stored = receipts.get(record.idempotencyKey);
  if (stored) return { ...stored, finalized, txOrPaymentRef: record.txHash ?? stored.txOrPaymentRef };
  return {
    txOrPaymentRef: record.txHash ?? "",
    finalized,
    actualPrincipalAmount: BigInt(record.principal),
    actualFeeAmount: BigInt(record.quotedFeeAmount),
    actualGasAmount: BigInt(record.maxGasFee),
  };
}

function withFinality(receipt: ExecutionReceipt, record: AttemptRecord): ExecutionReceipt {
  return { ...receipt, finalized: record.status === "FINALIZED", txOrPaymentRef: record.txHash ?? receipt.txOrPaymentRef };
}

function openAttemptForLease(leases: Map<string, SequenceLease>, ledger: AttemptLedger, lease: SequenceLease): string | undefined {
  for (const [attemptId, stored] of leases) {
    if (stored.leaseId !== lease.leaseId || stored.expiresAtEpochSec !== lease.expiresAtEpochSec) continue;
    const record = ledger.get(attemptId);
    if (record && isPreInclusion(record.status)) return attemptId;
  }
  return undefined;
}

function readerCanAdvance(status: AttemptStatus): boolean {
  return status === "IN_FLIGHT_PENDING" || status === "REPLACED" || status === "INCLUDED_UNFINALIZED";
}

function isPreInclusion(status: AttemptStatus): boolean {
  return status === "CREATED" || status === "IN_FLIGHT_PENDING" || status === "REPLACED";
}

function referenceId(value: string): string | undefined {
  if (/^0x[a-fA-F0-9]{64}$/.test(value)) return value.toLowerCase();
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(value)) return value;
  return undefined;
}

function normalizeAttemptId(key: string): string {
  return /^0x[a-fA-F0-9]{64}$/.test(key) ? key.toLowerCase() : key;
}

function isIdempotencyKey(key: string): boolean {
  return /^0x[a-f0-9]{64}$/.test(key) || /^[A-Za-z0-9._:-]{16,128}$/.test(key);
}

/** Matches the ledger settlement-ref grammar: 32-byte hex or a base58 signature. */
export function asSettlementRef(value: string): string | undefined {
  if (/^0x[a-fA-F0-9]{64}$/.test(value)) return value.toLowerCase();
  if (/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value)) return value;
  return undefined;
}
