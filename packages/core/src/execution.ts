import { keccak256, toBytes } from "viem";
import { normalizeAddress } from "./address.js";
import { canonicalJson } from "./canonical.js";
import { evaluateSpend, spentInWindow } from "./evaluate.js";
import { parseNonNegativeInteger } from "./integers.js";
import { normalizePolicy, policyHashOrZero } from "./policy.js";
import { REASON_MESSAGES } from "./reasons.js";
import type { ReasonCode } from "./reasons.js";
import { tighten } from "./tighten.js";
import type { TighteningOpinion } from "./tighten.js";
import type { EpochUsage, Outcome, Protocol, SpendDecision, SpendPolicy } from "./types.js";

/**
 * Status vocabulary shared with `AttemptModel` in the contracts tree.
 * FINALIZED is terminal. A released terminal can be retried only through `begin`.
 */
export const ATTEMPT_STATUSES = [
  "CREATED",
  "IN_FLIGHT_PENDING",
  "INCLUDED_UNFINALIZED",
  "FINALIZED",
  "DROPPED",
  "REPLACED",
  "REVERTED",
  "EXPIRED_OR_DROPPED",
  "FAILED",
] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];
export type FinalityTier = "fast" | "irreversible";
export type QueueMode = "serial" | "async";

const RELEASED = new Set<AttemptStatus>(["DROPPED", "REVERTED", "EXPIRED_OR_DROPPED", "FAILED"]);

export type PaymentIntent = {
  /** Explicit caller key. When omitted, the ledger derives one from the four identity fields. */
  idempotencyKey?: string;
  agentId: string;
  sessionId: string;
  requestIntentId: string;
  protocol: Protocol;
  environment: SpendPolicy["environment"];
  chain: string;
  asset: string;
  recipient: string;
  amount: string;
  endpoint?: string;
  now: number;
  deadline: number;
  signer: string;
  finality: FinalityTier;
  queue?: QueueMode;
  quotedFeeAmount?: string;
  maxGasFee?: string;
  challengeId?: string;
  mandateId?: string;
  /** Required for `solana:` chains. Also honored on any chain when the host sets it. */
  blockhashExpiresAt?: number;
  stepUpSatisfied?: boolean;
};

export type AttemptRecord = {
  idempotencyKey: string;
  attemptCount: number;
  status: AttemptStatus;
  outcome: Outcome;
  reason: ReasonCode;
  message: string;
  policyHash: `0x${string}`;
  sessionId: string;
  agentId: string;
  requestIntentId: string;
  protocol: Protocol;
  chain: string;
  asset: string;
  recipient: string;
  signer: string;
  principal: string;
  quotedFeeAmount: string;
  maxGasFee: string;
  reservedAmount: string;
  settledAmount: string;
  txHash?: string;
  nonce?: string;
  /** True when a released attempt gave its nonce back because no later nonce is outstanding. */
  nonceReusable: boolean;
  receiptId?: string;
  challengeId?: string;
  mandateId?: string;
  deadline: number;
  finality: FinalityTier;
  queue: QueueMode;
  /** The payment is in a success state. Fast tier settles at inclusion. Irreversible tier settles at FINALIZED. */
  settled: boolean;
  /** The signer may start another attempt. A released attempt is ready even though it did not settle. */
  readyForNext: boolean;
  createdAt: number;
  updatedAt: number;
};

export type BeginResult = {
  decision: SpendDecision;
  /** True only when this call created a new reservation. */
  reserved: boolean;
  /** True when the key already had an open or settled attempt. No second reservation was taken. */
  replay: boolean;
  record?: AttemptRecord;
};

export type AttemptObservation = {
  status: AttemptStatus;
  now: number;
  txHash?: string;
  actualAmount?: string;
  actualFee?: string;
  actualGas?: string;
  receiptId?: string;
  reason?: ReasonCode;
};

export type ObserveResult = {
  accepted: boolean;
  reason: ReasonCode;
  message: string;
  record?: AttemptRecord;
};

type Book = { committed: bigint; windowStartedAt: number };

type Stored = {
  idempotencyKey: string;
  attemptCount: number;
  status: AttemptStatus;
  outcome: Outcome;
  reason: ReasonCode;
  message: string;
  policyHash: `0x${string}`;
  budgetKey: string;
  sessionId: string;
  agentId: string;
  requestIntentId: string;
  protocol: Protocol;
  chain: string;
  asset: string;
  recipient: string;
  signer: string;
  principal: bigint;
  /** Set when this realm releases one EIP-3009 payload for the reservation. */
  payloadNonce?: string;
  quotedFee: bigint;
  maxGas: bigint;
  reservedAmount: bigint;
  holdingReservation: boolean;
  committedApplied: bigint;
  settledPrincipal?: bigint;
  settledFee?: bigint;
  settledGas?: bigint;
  txHash?: string;
  nonce?: string;
  nonceReusable: boolean;
  receiptId?: string;
  challengeId?: string;
  mandateId?: string;
  consumedChallenge?: string;
  consumedMandate?: string;
  deadline: number;
  blockhashExpiresAt?: number;
  finality: FinalityTier;
  queue: QueueMode;
  createdAt: number;
  updatedAt: number;
};

/**
 * In-process attempt ledger.
 * shortcut: one JavaScript realm is the atomic reservation boundary; upgrade to a shared serializable store before running more than one host process.
 * The reference PolicyAnchor still accounts a guarded transfer when it lands. This ledger reserves before that broadcast and releases when the attempt dies.
 */
export class AttemptLedger {
  /** shortcut: one JavaScript realm is the atomic reservation boundary; upgrade to a shared serializable store before running more than one host process. */
  readonly isolation = "javascript-realm" as const;
  private readonly attempts = new Map<string, Stored>();
  private readonly books = new Map<string, Book>();
  private readonly consumed = new Set<string>();
  private readonly nextNonce = new Map<string, bigint>();

  /** Sets the next nonce this signer may use. The cursor can move forward. It cannot move backward. */
  setSignerNonce(signer: string, nonce: string): void {
    const key = signerKey(signer);
    const value = parseNonNegativeInteger(nonce, "Nonce");
    const current = this.nextNonce.get(key);
    if (current !== undefined && value < current) {
      throw new Error("Nonce cursor cannot move backward.");
    }
    this.nextNonce.set(key, value);
  }

  outstanding(policyHash: `0x${string}`, signer: string): string {
    return this.held(`${policyHash}:${signerKey(signer)}`).toString();
  }

  get(idempotencyKey: string): AttemptRecord | undefined {
    const stored = this.attempts.get(normalizeKey(idempotencyKey));
    return stored ? view(stored) : undefined;
  }

  begin(input: {
    policy: SpendPolicy;
    intent: PaymentIntent;
    chainUsage: EpochUsage;
    tightening?: TighteningOpinion;
  }): BeginResult {
    let policy: SpendPolicy;
    try {
      policy = normalizePolicy(input.policy);
    } catch (error) {
      return this.block(input.policy, "BLOCK_MALFORMED_REQUEST", errorText(error));
    }
    try {
      this.expireDue(input.intent.now);
      return this.beginNormalized(policy, input.intent, input.chainUsage, input.tightening);
    } catch (error) {
      return this.block(policy, "BLOCK_MALFORMED_REQUEST", errorText(error));
    }
  }

  observe(idempotencyKey: string, observation: AttemptObservation): ObserveResult {
    const attempt = this.attempts.get(normalizeKey(idempotencyKey));
    if (!attempt) {
      return { accepted: false, reason: "BLOCK_MALFORMED_REQUEST", message: "Unknown attempt." };
    }
    if (!Number.isInteger(observation.now) || observation.now < 0) {
      return refuse(attempt, "Timestamp is invalid.");
    }
    if (!canTransition(attempt.status, observation.status)) {
      return refuse(attempt, "That status transition is not available.");
    }
    const nextHash = observation.txHash === undefined ? attempt.txHash : normalizeRef(observation.txHash);
    if (requiresSettlementRef(observation.status) && !isSettlementRef(nextHash)) {
      return refuse(attempt, "This status needs a transaction hash or signature.");
    }
    if (observation.status === "REPLACED" && nextHash === attempt.txHash) {
      return refuse(attempt, "A replacement needs a new transaction hash or signature.");
    }
    if (nextHash && this.consumed.has(globalRef(nextHash)) && nextHash !== attempt.txHash) {
      return refuse(attempt, REASON_MESSAGES.BLOCK_REPLAY, "BLOCK_REPLAY");
    }
    if (observation.receiptId && this.consumed.has(globalRef(observation.receiptId)) && observation.receiptId !== attempt.receiptId) {
      return refuse(attempt, REASON_MESSAGES.BLOCK_REPLAY, "BLOCK_REPLAY");
    }

    let actuals: { principal: bigint; fee: bigint; gas: bigint } | undefined;
    if (effectFor(observation.status, attempt.finality) === "commit") {
      const parsed = parseActuals(attempt, observation);
      if (!parsed.ok) return refuse(attempt, parsed.message);
      actuals = parsed.value;
    }

    const previousHash = attempt.txHash;
    attempt.status = observation.status;
    attempt.updatedAt = observation.now;
    if (nextHash) attempt.txHash = nextHash;
    if (observation.receiptId) attempt.receiptId = observation.receiptId;
    if (observation.status === "REPLACED" && previousHash) this.consumed.add(globalRef(previousHash));

    const effect = effectFor(attempt.status, attempt.finality);
    if (effect === "commit" && actuals) {
      this.commit(attempt, actuals);
      this.consumeSettled(attempt);
      attempt.outcome = "allow";
    } else if (effect === "release") {
      this.release(attempt);
      attempt.outcome = "block";
      if (observation.reason) {
        attempt.reason = observation.reason;
        attempt.message = REASON_MESSAGES[observation.reason];
      } else if (observation.status === "EXPIRED_OR_DROPPED") {
        attempt.reason = "BLOCK_DEADLINE_EXCEEDED";
        attempt.message = REASON_MESSAGES.BLOCK_DEADLINE_EXCEEDED;
      } else {
        attempt.message = releaseMessage(observation.status);
      }
    }

    const record = view(attempt);
    return { accepted: true, reason: record.reason, message: record.message, record };
  }

  /**
   * Binds one EIP-3009 nonce to a reserved x402 attempt in this ledger.
   * The same nonce may be read again. A different nonce is refused. This does not reserve budget.
   */
  claimPayloadNonce(idempotencyKey: string, nonce: string): string {
    const attempt = this.attempts.get(normalizeKey(idempotencyKey));
    if (!attempt || attempt.protocol !== "x402" || attempt.outcome !== "allow" || attempt.status !== "CREATED" || !attempt.holdingReservation) {
      throw new Error("EIP-3009 stays withheld until this ledger reserves the attempt.");
    }
    const normalized = nonce.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(normalized)) throw new Error("EIP-3009 nonce must be 32 bytes.");
    if (attempt.payloadNonce && attempt.payloadNonce !== normalized) {
      throw new Error("This reservation already released an EIP-3009 payload.");
    }
    attempt.payloadNonce = normalized;
    return normalized;
  }

  boundPayloadNonce(idempotencyKey: string): string | undefined {
    return this.attempts.get(normalizeKey(idempotencyKey))?.payloadNonce;
  }

  /** Releases pre-inclusion attempts whose deadline or blockhash window has ended. */
  expireDue(now: number): AttemptRecord[] {
    if (!Number.isInteger(now) || now < 0) throw new Error("Timestamp is invalid.");
    const changed: AttemptRecord[] = [];
    for (const attempt of this.attempts.values()) {
      if (!preInclusion(attempt.status)) continue;
      const hashDead = attempt.blockhashExpiresAt !== undefined && now >= attempt.blockhashExpiresAt;
      const deadlineDead = now >= attempt.deadline;
      if (!hashDead && !deadlineDead) continue;
      if (!canTransition(attempt.status, "EXPIRED_OR_DROPPED")) continue;
      attempt.status = "EXPIRED_OR_DROPPED";
      attempt.updatedAt = now;
      this.release(attempt);
      attempt.outcome = "block";
      attempt.reason = "BLOCK_DEADLINE_EXCEEDED";
      attempt.message = REASON_MESSAGES.BLOCK_DEADLINE_EXCEEDED;
      changed.push(view(attempt));
    }
    return changed;
  }

  private beginNormalized(
    policy: SpendPolicy,
    intent: PaymentIntent,
    chainUsage: EpochUsage,
    tightening: TighteningOpinion | undefined,
  ): BeginResult {
    const hash = policyHashOrZero(policy);
    const agentId = token(intent.agentId, "Agent id");
    const sessionId = token(intent.sessionId, "Session id");
    const requestIntentId = token(intent.requestIntentId, "Request intent id");
    const key = intent.idempotencyKey
      ? normalizeKey(intent.idempotencyKey)
      : deriveIdempotencyKey({ agentId, sessionId, protocol: intent.protocol, requestIntentId });
    if (intent.idempotencyKey && !isIdempotencyKey(key)) {
      return this.block(policy, "BLOCK_MALFORMED_REQUEST", "Idempotency key is invalid.");
    }

    const existing = this.attempts.get(key);
    if (existing && !RELEASED.has(existing.status)) {
      return {
        decision: {
          outcome: existing.outcome,
          reason: existing.reason,
          message: "This idempotency key already has an attempt.",
          policyHash: existing.policyHash,
        },
        reserved: false,
        replay: true,
        record: view(existing),
      };
    }

    if (!Number.isInteger(intent.now) || intent.now < 0 || !Number.isInteger(intent.deadline)) {
      return this.block(policy, "BLOCK_MALFORMED_REQUEST", "Timestamp is invalid.");
    }
    if (intent.deadline <= intent.now || intent.deadline > policy.session.validUntil) {
      return this.block(policy, "BLOCK_DEADLINE_EXCEEDED");
    }
    if (intent.finality !== "fast" && intent.finality !== "irreversible") {
      return this.block(policy, "BLOCK_MALFORMED_REQUEST", "Finality tier is invalid.");
    }
    const queue = intent.queue ?? "serial";
    if (queue !== "serial" && queue !== "async") {
      return this.block(policy, "BLOCK_MALFORMED_REQUEST", "Queue mode is invalid.");
    }
    if (intent.chain.startsWith("solana:")) {
      if (!Number.isInteger(intent.blockhashExpiresAt) || (intent.blockhashExpiresAt ?? 0) <= intent.now || (intent.blockhashExpiresAt ?? 0) > intent.deadline) {
        return this.block(policy, "BLOCK_MALFORMED_REQUEST", "A Solana attempt needs a live blockhash expiry inside the deadline.");
      }
    } else if (intent.blockhashExpiresAt !== undefined && (!Number.isInteger(intent.blockhashExpiresAt) || intent.blockhashExpiresAt <= intent.now)) {
      return this.block(policy, "BLOCK_DEADLINE_EXCEEDED");
    }

    const signer = intent.chain.startsWith("eip155:") ? normalizeAddress(intent.signer) : intent.signer.trim();
    if (signer !== policy.session.signer) {
      return this.block(policy, "BLOCK_MALFORMED_REQUEST", "The attempt signer must be the session signer.");
    }
    const challengeId = intent.challengeId === undefined ? undefined : referenceId(intent.challengeId, "Challenge id");
    const mandateId = intent.mandateId === undefined ? undefined : referenceId(intent.mandateId, "Mandate id");
    if ((challengeId && this.consumed.has(signerRef(signer, challengeId))) || (mandateId && this.consumed.has(signerRef(signer, mandateId)))) {
      return this.block(policy, "BLOCK_REPLAY");
    }
    if (intent.chain.startsWith("eip155:") && !this.nextNonce.has(signer)) {
      return this.block(policy, "BLOCK_NONCE_UNAVAILABLE");
    }
    if (queue === "serial" && this.signerBlocked(signer, key)) {
      return this.block(policy, "BLOCK_ATTEMPT_IN_FLIGHT");
    }

    const spent = this.effectiveSpent(hash, signer, policy, chainUsage, intent.now);
    let decision = evaluateSpend({
      policy,
      usage: { spent: spent.toString(), windowStartedAt: intent.now },
      stepUpSatisfied: intent.stepUpSatisfied,
      request: {
        protocol: intent.protocol,
        environment: intent.environment,
        chain: intent.chain,
        asset: intent.asset,
        recipient: intent.recipient,
        amount: intent.amount,
        now: intent.now,
        ...(intent.endpoint === undefined ? {} : { endpoint: intent.endpoint }),
        ...(intent.quotedFeeAmount === undefined ? {} : { quotedFeeAmount: intent.quotedFeeAmount }),
        ...(intent.maxGasFee === undefined ? {} : { maxGasFee: intent.maxGasFee }),
      },
    });
    if (tightening) decision = tighten(decision, tightening);
    if (decision.outcome !== "allow") return { decision, reserved: false, replay: false };

    const principal = BigInt(intent.amount);
    const quotedFee = BigInt(intent.quotedFeeAmount ?? "0");
    const maxGas = BigInt(intent.maxGasFee ?? "0");
    const nonce = intent.chain.startsWith("eip155:") ? this.assignNonce(signer) : undefined;
    const stored: Stored = {
      idempotencyKey: key,
      attemptCount: existing ? existing.attemptCount + 1 : 1,
      status: "CREATED",
      outcome: decision.outcome,
      reason: decision.reason,
      message: decision.message,
      policyHash: decision.policyHash,
      budgetKey: `${hash}:${signer}`,
      sessionId,
      agentId,
      requestIntentId,
      protocol: intent.protocol,
      chain: intent.chain,
      asset: /^0x[a-fA-F0-9]{40}$/.test(intent.asset) ? normalizeAddress(intent.asset) : intent.asset,
      recipient: intent.chain.startsWith("eip155:") ? normalizeAddress(intent.recipient) : intent.recipient.trim(),
      signer,
      principal,
      quotedFee,
      maxGas,
      reservedAmount: principal + quotedFee + maxGas,
      holdingReservation: true,
      committedApplied: 0n,
      nonce,
      nonceReusable: false,
      ...(challengeId ? { challengeId } : {}),
      ...(mandateId ? { mandateId } : {}),
      deadline: intent.deadline,
      ...(intent.blockhashExpiresAt === undefined ? {} : { blockhashExpiresAt: intent.blockhashExpiresAt }),
      finality: intent.finality,
      queue,
      createdAt: existing?.createdAt ?? intent.now,
      updatedAt: intent.now,
    };
    this.attempts.set(key, stored);
    return { decision, reserved: true, replay: false, record: view(stored) };
  }

  private effectiveSpent(policyHash: `0x${string}`, signer: string, policy: SpendPolicy, usage: EpochUsage, now: number): bigint {
    const budgetKey = `${policyHash}:${signer}`;
    const chainSpent = spentInWindow(policy, usage, now);
    let book = this.books.get(budgetKey);
    if (!book) {
      book = { committed: 0n, windowStartedAt: usage.windowStartedAt };
      this.books.set(budgetKey, book);
    }
    if (now >= book.windowStartedAt + policy.limits.epochSeconds) {
      book.committed = 0n;
      book.windowStartedAt = usage.windowStartedAt;
    } else if (usage.windowStartedAt >= book.windowStartedAt && usage.windowStartedAt <= now) {
      book.windowStartedAt = usage.windowStartedAt;
    }
    const localSpent = spentInWindow(policy, { spent: book.committed.toString(), windowStartedAt: book.windowStartedAt }, now);
    const base = chainSpent > localSpent ? chainSpent : localSpent;
    return base + this.held(budgetKey);
  }

  private held(budgetKey: string): bigint {
    let total = 0n;
    for (const attempt of this.attempts.values()) {
      if (attempt.budgetKey === budgetKey && attempt.holdingReservation) total += attempt.reservedAmount;
    }
    return total;
  }

  private signerBlocked(signer: string, exceptKey: string): boolean {
    for (const attempt of this.attempts.values()) {
      if (attempt.signer === signer && attempt.idempotencyKey !== exceptKey && blocksQueue(attempt)) return true;
    }
    return false;
  }

  private assignNonce(signer: string): string {
    const next = this.nextNonce.get(signer);
    if (next === undefined) throw new Error("Nonce cursor is missing.");
    this.nextNonce.set(signer, next + 1n);
    return next.toString();
  }

  private commit(attempt: Stored, actuals: { principal: bigint; fee: bigint; gas: bigint }): void {
    const book = this.books.get(attempt.budgetKey) ?? { committed: 0n, windowStartedAt: attempt.createdAt };
    this.books.set(attempt.budgetKey, book);
    attempt.holdingReservation = false;
    const actual = actuals.principal + actuals.fee + actuals.gas;
    book.committed += actual - attempt.committedApplied;
    attempt.committedApplied = actual;
    attempt.settledPrincipal = actuals.principal;
    attempt.settledFee = actuals.fee;
    attempt.settledGas = actuals.gas;
  }

  private release(attempt: Stored): void {
    if (attempt.committedApplied > 0n) {
      const book = this.books.get(attempt.budgetKey);
      if (book) {
        book.committed -= attempt.committedApplied;
        if (book.committed < 0n) book.committed = 0n;
      }
      attempt.committedApplied = 0n;
    }
    attempt.holdingReservation = false;
    attempt.settledPrincipal = undefined;
    attempt.settledFee = undefined;
    attempt.settledGas = undefined;
    if (attempt.consumedChallenge) {
      this.consumed.delete(signerRef(attempt.signer, attempt.consumedChallenge));
      attempt.consumedChallenge = undefined;
    }
    if (attempt.consumedMandate) {
      this.consumed.delete(signerRef(attempt.signer, attempt.consumedMandate));
      attempt.consumedMandate = undefined;
    }
    if (attempt.nonce !== undefined) {
      const nonce = BigInt(attempt.nonce);
      const tip = this.nextNonce.get(attempt.signer);
      if (tip === nonce + 1n) {
        this.nextNonce.set(attempt.signer, nonce);
        attempt.nonceReusable = true;
      } else {
        attempt.nonceReusable = false;
      }
    }
  }

  private consumeSettled(attempt: Stored): void {
    if (attempt.challengeId) {
      this.consumed.add(signerRef(attempt.signer, attempt.challengeId));
      attempt.consumedChallenge = attempt.challengeId;
    }
    if (attempt.mandateId) {
      this.consumed.add(signerRef(attempt.signer, attempt.mandateId));
      attempt.consumedMandate = attempt.mandateId;
    }
    if (attempt.txHash) this.consumed.add(globalRef(attempt.txHash));
    if (attempt.receiptId) this.consumed.add(globalRef(attempt.receiptId));
  }

  private block(policy: SpendPolicy, reason: ReasonCode, message?: string): BeginResult {
    return {
      decision: {
        outcome: "block",
        reason,
        message: message ?? REASON_MESSAGES[reason],
        policyHash: policyHashOrZero(policy),
      },
      reserved: false,
      replay: false,
    };
  }
}

export function deriveIdempotencyKey(parts: {
  agentId: string;
  sessionId: string;
  protocol: Protocol;
  requestIntentId: string;
}): string {
  token(parts.agentId, "Agent id");
  token(parts.sessionId, "Session id");
  token(parts.requestIntentId, "Request intent id");
  if (!new Set(["x402", "ap2", "mpp", "mcp", "onchain"]).has(parts.protocol)) throw new Error("Unknown protocol.");
  return keccak256(
    toBytes(
      canonicalJson({
        agentId: parts.agentId,
        protocol: parts.protocol,
        requestIntentId: parts.requestIntentId,
        sessionId: parts.sessionId,
      }),
    ),
  );
}

export function canTransition(from: AttemptStatus, to: AttemptStatus): boolean {
  if (from === to) return false;
  if (from === "CREATED") return to === "IN_FLIGHT_PENDING" || to === "FAILED" || to === "EXPIRED_OR_DROPPED";
  if (from === "IN_FLIGHT_PENDING") {
    return (
      to === "INCLUDED_UNFINALIZED" ||
      to === "DROPPED" ||
      to === "REPLACED" ||
      to === "REVERTED" ||
      to === "EXPIRED_OR_DROPPED" ||
      to === "FAILED"
    );
  }
  if (from === "REPLACED") {
    return to === "IN_FLIGHT_PENDING" || to === "DROPPED" || to === "EXPIRED_OR_DROPPED" || to === "FAILED" || to === "REVERTED";
  }
  if (from === "INCLUDED_UNFINALIZED") {
    return to === "FINALIZED" || to === "REVERTED" || to === "DROPPED" || to === "FAILED" || to === "EXPIRED_OR_DROPPED";
  }
  return false;
}

function effectFor(status: AttemptStatus, finality: FinalityTier): "hold" | "commit" | "release" {
  if (status === "FINALIZED") return "commit";
  if (status === "INCLUDED_UNFINALIZED" && finality === "fast") return "commit";
  if (RELEASED.has(status)) return "release";
  return "hold";
}

function preInclusion(status: AttemptStatus): boolean {
  return status === "CREATED" || status === "IN_FLIGHT_PENDING" || status === "REPLACED";
}

function blocksQueue(attempt: Stored): boolean {
  if (RELEASED.has(attempt.status) || attempt.status === "FINALIZED") return false;
  if (attempt.finality === "fast" && attempt.status === "INCLUDED_UNFINALIZED") return false;
  return true;
}

function requiresSettlementRef(status: AttemptStatus): boolean {
  return status === "IN_FLIGHT_PENDING" || status === "INCLUDED_UNFINALIZED" || status === "FINALIZED" || status === "REPLACED";
}

function view(attempt: Stored): AttemptRecord {
  const settled = attempt.status === "FINALIZED" || (attempt.finality === "fast" && attempt.status === "INCLUDED_UNFINALIZED");
  return {
    idempotencyKey: attempt.idempotencyKey,
    attemptCount: attempt.attemptCount,
    status: attempt.status,
    outcome: attempt.outcome,
    reason: attempt.reason,
    message: attempt.message,
    policyHash: attempt.policyHash,
    sessionId: attempt.sessionId,
    agentId: attempt.agentId,
    requestIntentId: attempt.requestIntentId,
    protocol: attempt.protocol,
    chain: attempt.chain,
    asset: attempt.asset,
    recipient: attempt.recipient,
    signer: attempt.signer,
    principal: attempt.principal.toString(),
    quotedFeeAmount: attempt.quotedFee.toString(),
    maxGasFee: attempt.maxGas.toString(),
    reservedAmount: attempt.reservedAmount.toString(),
    settledAmount: attempt.committedApplied.toString(),
    ...(attempt.txHash ? { txHash: attempt.txHash } : {}),
    ...(attempt.nonce === undefined ? {} : { nonce: attempt.nonce }),
    nonceReusable: attempt.nonceReusable,
    ...(attempt.receiptId ? { receiptId: attempt.receiptId } : {}),
    ...(attempt.challengeId ? { challengeId: attempt.challengeId } : {}),
    ...(attempt.mandateId ? { mandateId: attempt.mandateId } : {}),
    deadline: attempt.deadline,
    finality: attempt.finality,
    queue: attempt.queue,
    settled,
    readyForNext: !blocksQueue(attempt),
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}

function parseActuals(
  attempt: Stored,
  observation: AttemptObservation,
): { ok: true; value: { principal: bigint; fee: bigint; gas: bigint } } | { ok: false; message: string } {
  try {
    const principal = observation.actualAmount !== undefined ? parseNonNegativeInteger(observation.actualAmount, "Settled amount") : attempt.settledPrincipal ?? attempt.principal;
    const fee = observation.actualFee !== undefined ? parseNonNegativeInteger(observation.actualFee, "Settled fee") : attempt.settledFee ?? attempt.quotedFee;
    const gas = observation.actualGas !== undefined ? parseNonNegativeInteger(observation.actualGas, "Settled gas") : attempt.settledGas ?? attempt.maxGas;
    if (principal > attempt.principal || fee > attempt.quotedFee || gas > attempt.maxGas) {
      return { ok: false, message: "Settled amounts are above the reserved amounts." };
    }
    return { ok: true, value: { principal, fee, gas } };
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
}

function refuse(attempt: Stored, message: string, reason: ReasonCode = "BLOCK_MALFORMED_REQUEST"): ObserveResult {
  return { accepted: false, reason, message, record: view(attempt) };
}

function releaseMessage(status: AttemptStatus): string {
  if (status === "DROPPED") return "The transaction was dropped before it settled.";
  if (status === "REVERTED") return "The transaction reverted.";
  if (status === "FAILED") return "The attempt failed before it settled.";
  return "The attempt ended before it settled.";
}

function signerKey(signer: string): string {
  return /^0x[a-fA-F0-9]{40}$/.test(signer) ? signer.toLowerCase() : signer.trim();
}

function signerRef(signer: string, id: string): string {
  return `signer:${signer}:${id}`;
}

function globalRef(id: string): string {
  return `ref:${id}`;
}

function token(value: string, label: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function referenceId(value: string, label: string): string {
  if (/^0x[a-fA-F0-9]{64}$/.test(value)) return value.toLowerCase();
  return token(value, label);
}

function normalizeKey(key: string): string {
  return /^0x[a-fA-F0-9]{64}$/.test(key) ? key.toLowerCase() : key;
}

function isIdempotencyKey(key: string): boolean {
  return /^0x[a-f0-9]{64}$/.test(key) || /^[A-Za-z0-9._:-]{16,128}$/.test(key);
}

function isSettlementRef(value: string | undefined): boolean {
  if (!value) return false;
  return /^0x[a-f0-9]{64}$/.test(value) || /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value);
}

function normalizeRef(value: string): string {
  return /^0x[a-fA-F0-9]{64}$/.test(value) ? value.toLowerCase() : value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : REASON_MESSAGES.BLOCK_MALFORMED_REQUEST;
}
