import type { ReasonCode } from "./reasons.js";

export type Environment = "sandbox" | "mainnet";

export type Protocol = "x402" | "ap2" | "mpp" | "mcp" | "onchain";

export type Outcome = "allow" | "block" | "step_up";

export type AssetId = {
  chain: string;
  asset: string;
  symbol: string;
  decimals: number;
};

export type McpAllow = {
  server: string;
  tools: string[];
};

export type SpendPolicy = {
  version: "1";
  policyId: string;
  account: string;
  environment: Environment;
  chains: string[];
  assets: AssetId[];
  limits: {
    perTransaction: string;
    perEpoch: string;
    epochSeconds: number;
    stepUpAbove: string;
    /**
     * User ceiling for a platform fee, in asset minor units.
     * Omitted means a quoted fee is refused. This is not a rate table.
     */
    maxFeeAmount?: string;
    /** User ceiling for a platform fee, in basis points of the payment amount. 10_000 is 100%. */
    maxFeeBps?: number;
    /** User ceiling for sponsored gas reimbursement, in asset minor units. */
    maxGasAmount?: string;
    /** User ceiling for principal plus quoted fee plus gas on one attempt, in asset minor units. */
    maxCombinedAmount?: string;
  };
  allowlists: {
    recipients: string[];
    endpoints: string[];
    mcp: McpAllow[];
  };
  mandates: {
    requireIntentForAutonomous: boolean;
    maxMandateTtlSeconds: number;
  };
  session: {
    signer: string;
    validUntil: number;
    paused: boolean;
  };
};

export type SpendRequest = {
  protocol: Protocol;
  environment: Environment;
  chain: string;
  asset: string;
  recipient: string;
  amount: string;
  endpoint?: string;
  now: number;
  /** Platform fee quoted for this attempt, in asset minor units. Omitted means zero. */
  quotedFeeAmount?: string;
  /** Gas or facilitator reimbursement reserved for this attempt, in asset minor units. Omitted means zero. */
  maxGasFee?: string;
};

export type EpochUsage = {
  spent: string;
  windowStartedAt: number;
};

export type SpendDecision = {
  outcome: Outcome;
  reason: ReasonCode;
  message: string;
  policyHash: `0x${string}`;
};

export type AnchorDraft = {
  policyHash: `0x${string}`;
  sessionSigner: `0x${string}`;
  asset: `0x${string}`;
  validUntil: number;
  epochSeconds: number;
  perTxCap: bigint;
  epochCap: bigint;
  stepUpAbove: bigint;
  recipients: `0x${string}`[];
};
