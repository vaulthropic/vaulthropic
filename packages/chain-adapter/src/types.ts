import type { FinalityTier, ReasonCode } from "@vaulthropic/core";
import type { Protocol } from "@vaulthropic/core";

/**
 * Adapter-facing protocol spelling.
 * The ledger stores the lowercase `Protocol`. Uppercase spec names normalize to that set.
 */
export type AdapterProtocolName = Protocol | "X402" | "AP2" | "MPP" | "MCP" | "ONCHAIN";

export type QuoteEstimate = {
  /** CAIP-2 id, or `mpp:tempo` for the payment-credential rail. */
  chainId: string;
  /** Allowlisted asset address, symbol, or rail token id. */
  asset: string;
  principalAmount: bigint;
  quotedFeeAmount: bigint;
  /** Gas or facilitator reimbursement, in the same minor units as the principal. */
  estimatedGasAmount: bigint;
  deadlineEpochSec: number;
};

export type SequenceLease = {
  /** EVM nonce, Solana blockhash, or MPP credential-window id. */
  leaseId: string;
  expiresAtEpochSec: number;
};

export type ExecutionReceipt = {
  txOrPaymentRef: string;
  /** True when the ledger status is FINALIZED. Fast inclusion can settle earlier and still report false here. */
  finalized: boolean;
  actualPrincipalAmount: bigint;
  actualFeeAmount: bigint;
  actualGasAmount: bigint;
};

/**
 * Poll states use AttemptLedger statuses.
 * The spec name IN_FLIGHT is IN_FLIGHT_PENDING.
 * The spec name FAILED_OR_REVERTED is REVERTED or FAILED.
 * RESERVED is the hold on CREATED. NONCE_ASSIGNED is the lease. A block before `begin` is a decision, not a status.
 */
export type AdapterPoll =
  | { state: "CREATED" | "IN_FLIGHT_PENDING" | "REPLACED" }
  | { state: "INCLUDED_UNFINALIZED"; receipt?: ExecutionReceipt }
  | { state: "FINALIZED"; receipt: ExecutionReceipt }
  | { state: "REVERTED" | "FAILED" | "DROPPED"; reasonCode: ReasonCode; receipt?: ExecutionReceipt }
  | { state: "EXPIRED_OR_DROPPED"; reasonCode: ReasonCode };

export type SequenceMode = "SERIAL" | "CONCURRENT_BOUNDED";

export type ChainAdapter = {
  readonly adapterId: string;
  readonly supportedChains: readonly string[];
  /** Default is irreversible. A host opts into fast inclusion on the adapter host. */
  readonly finality: FinalityTier;

  estimateAndValidate(params: {
    attemptId: string;
    protocol: AdapterProtocolName;
    recipient: string;
    endpointOrMandateRef: string;
    quote: QuoteEstimate;
  }): Promise<{ ok: true } | { ok: false; reasonCode: ReasonCode }>;

  acquireSequence(params: {
    attemptId: string;
    chainId: string;
    signerOrAccountRef: string;
    mode: SequenceMode;
  }): Promise<{ ok: true; lease: SequenceLease } | { ok: false; reasonCode: ReasonCode }>;

  submitAttempt(params: {
    attemptId: string;
    lease: SequenceLease;
    signedPayloadOrCredential: string;
  }): Promise<{ ok: true; txOrPaymentRef: string } | { ok: false; reasonCode: ReasonCode }>;

  pollStatus(params: {
    attemptId: string;
    txOrPaymentRef: string;
    lease: SequenceLease;
    nowEpochSec: number;
  }): Promise<AdapterPoll>;

  releaseSequence(lease: SequenceLease): Promise<void>;
};

/** Host-injected inclusion report. The adapter walks the legal AttemptLedger path from this report. */
export type InclusionReport =
  | { state: "IN_FLIGHT_PENDING" }
  | { state: "INCLUDED_UNFINALIZED"; receipt?: ExecutionReceipt }
  | { state: "FINALIZED"; receipt: ExecutionReceipt }
  | { state: "REVERTED" | "FAILED" | "DROPPED"; reasonCode?: ReasonCode; receipt?: ExecutionReceipt };

export type SolanaBlockhashLease = {
  blockhash: string;
  expiresAtEpochSec: number;
};

export type SolanaBlockhashSource = (input: {
  attemptId: string;
  chainId: string;
  nowEpochSec: number;
}) => Promise<SolanaBlockhashLease | null> | SolanaBlockhashLease | null;
