import { normalizeAddress } from "./address.js";
import { REFERENCE_CHAINS } from "./chains.js";
import { endpointAllowed } from "./endpoint.js";
import { parseNonNegativeInteger, parsePositiveInteger } from "./integers.js";
import { normalizePolicy, policyHashOrZero } from "./policy.js";
import { REASON_MESSAGES } from "./reasons.js";
import type { ReasonCode } from "./reasons.js";
import type { EpochUsage, SpendDecision, SpendPolicy, SpendRequest } from "./types.js";

export type EvaluateInput = {
  policy: SpendPolicy;
  usage: EpochUsage;
  request: SpendRequest;
  /** Host-supplied flag. Set it only after the owner factor has been verified. */
  stepUpSatisfied?: boolean;
};

export function evaluateSpend(input: EvaluateInput): SpendDecision {
  let policy: SpendPolicy;
  try {
    policy = normalizePolicy(input.policy);
  } catch (error) {
    return decision("block", "BLOCK_MALFORMED_REQUEST", errorText(error), policyHashOrZero(input.policy));
  }
  const hash = policyHashOrZero(policy);

  let request: SpendRequest;
  try {
    request = normalizeRequest(input.request);
  } catch (error) {
    return decision("block", "BLOCK_MALFORMED_REQUEST", errorText(error), hash);
  }

  if (request.environment !== policy.environment) {
    return block("BLOCK_SESSION_ENVIRONMENT", hash);
  }
  if (crossesReferenceRail(policy.environment, request.chain)) {
    return block("BLOCK_SESSION_ENVIRONMENT", hash);
  }
  if (request.now >= policy.session.validUntil) return block("BLOCK_SESSION_EXPIRED", hash);
  if (policy.session.paused) return block("BLOCK_PAUSED", hash);
  if (!policy.chains.includes(request.chain)) return block("BLOCK_CHAIN_NOT_ALLOWLISTED", hash);
  if (!assetAllowed(policy, request)) return block("BLOCK_ASSET_NOT_ALLOWLISTED", hash);
  if (!policy.allowlists.recipients.includes(request.recipient)) return block("BLOCK_RECIPIENT_NOT_ALLOWLISTED", hash);
  if (request.endpoint !== undefined && !endpointAllowed(policy.allowlists.endpoints, request.endpoint)) {
    return block("BLOCK_ENDPOINT_NOT_ALLOWLISTED", hash);
  }

  let amount: bigint;
  let alreadySpent: bigint;
  try {
    amount = parsePositiveInteger(request.amount, "Amount");
    alreadySpent = spentInWindow(policy, input.usage, request.now);
  } catch (error) {
    return decision("block", "BLOCK_MALFORMED_REQUEST", errorText(error), hash);
  }

  if (amount > BigInt(policy.limits.perTransaction)) return block("BLOCK_PER_TX_CAP", hash);
  const fee = minor(request.quotedFeeAmount);
  const gas = minor(request.maxGasFee);
  if (feeCeilingExceeded(policy, amount, fee)) return block("BLOCK_FEE_CEILING", hash);
  if (gasCeilingExceeded(policy, gas)) return block("BLOCK_GAS_CEILING", hash);
  const total = amount + fee + gas;
  if (policy.limits.maxCombinedAmount !== undefined && total > BigInt(policy.limits.maxCombinedAmount)) {
    return block("BLOCK_COMBINED_CEILING", hash);
  }
  if (alreadySpent + total > BigInt(policy.limits.perEpoch)) return block("BLOCK_EPOCH_CAP", hash);
  if (amount >= BigInt(policy.limits.stepUpAbove)) {
    if (input.stepUpSatisfied) return decision("allow", "ALLOW_STEP_UP", REASON_MESSAGES.ALLOW_STEP_UP, hash);
    return decision("step_up", "STEP_UP_ABOVE_THRESHOLD", REASON_MESSAGES.STEP_UP_ABOVE_THRESHOLD, hash);
  }
  return decision("allow", "ALLOW_WITHIN_POLICY", REASON_MESSAGES.ALLOW_WITHIN_POLICY, hash);
}

export function spentInWindow(policy: SpendPolicy, usage: EpochUsage, now: number): bigint {
  if (!Number.isInteger(now) || now < 0) throw new Error("Timestamp is invalid.");
  if (!Number.isInteger(usage.windowStartedAt) || usage.windowStartedAt < 0 || usage.windowStartedAt > now) {
    throw new Error("Epoch window is invalid.");
  }
  const spent = parseNonNegativeInteger(usage.spent, "Epoch spend");
  if (now >= usage.windowStartedAt + policy.limits.epochSeconds) return 0n;
  return spent;
}

function normalizeRequest(request: SpendRequest): SpendRequest {
  const protocols = new Set(["x402", "ap2", "mpp", "mcp", "onchain"]);
  if (!protocols.has(request.protocol)) throw new Error("Unknown protocol.");
  if (request.environment !== "sandbox" && request.environment !== "mainnet") {
    throw new Error("Environment must be sandbox or mainnet.");
  }
  if (!request.chain || request.chain.includes(" ")) throw new Error("Chain is invalid.");
  if (!Number.isInteger(request.now) || request.now < 0) throw new Error("Timestamp is invalid.");
  parsePositiveInteger(request.amount, "Amount");
  const quotedFeeAmount = optionalMinor(request.quotedFeeAmount, "Quoted fee");
  const maxGasFee = optionalMinor(request.maxGasFee, "Gas budget");
  const eip155 = request.chain.startsWith("eip155:");
  const recipient = eip155 ? normalizeAddress(request.recipient) : request.recipient.trim();
  const asset = eip155 && /^0x[a-fA-F0-9]{40}$/.test(request.asset) ? normalizeAddress(request.asset) : request.asset.trim();
  if (!recipient || !asset) throw new Error("Recipient and asset are required.");
  if (request.endpoint !== undefined && request.endpoint.trim() === "") throw new Error("Endpoint is empty.");
  return {
    protocol: request.protocol,
    environment: request.environment,
    chain: request.chain,
    asset,
    recipient,
    amount: request.amount,
    now: request.now,
    ...(request.endpoint === undefined ? {} : { endpoint: request.endpoint }),
    ...(quotedFeeAmount === undefined ? {} : { quotedFeeAmount }),
    ...(maxGasFee === undefined ? {} : { maxGasFee }),
  };
}

function optionalMinor(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  return parseNonNegativeInteger(value, label).toString();
}

function minor(value: string | undefined): bigint {
  return value === undefined ? 0n : BigInt(value);
}

/** A quoted fee needs a user ceiling. Both ceilings apply when the session sets both. */
function feeCeilingExceeded(policy: SpendPolicy, amount: bigint, fee: bigint): boolean {
  if (fee === 0n) return false;
  const maxAmount = policy.limits.maxFeeAmount;
  const maxBps = policy.limits.maxFeeBps;
  if (maxAmount === undefined && maxBps === undefined) return true;
  if (maxAmount !== undefined && fee > BigInt(maxAmount)) return true;
  if (maxBps !== undefined && fee > (amount * BigInt(maxBps)) / 10_000n) return true;
  return false;
}

function gasCeilingExceeded(policy: SpendPolicy, gas: bigint): boolean {
  if (gas === 0n) return false;
  const ceiling = policy.limits.maxGasAmount;
  return ceiling === undefined || gas > BigInt(ceiling);
}

function assetAllowed(policy: SpendPolicy, request: SpendRequest): boolean {
  return policy.assets.some((asset) => {
    if (asset.chain !== request.chain) return false;
    return asset.asset === request.asset || asset.symbol === request.asset.toUpperCase();
  });
}

function crossesReferenceRail(environment: SpendPolicy["environment"], chain: string): boolean {
  if (environment === "sandbox" && chain === REFERENCE_CHAINS.mainnet.caip2) return true;
  if (environment === "mainnet" && chain === REFERENCE_CHAINS.sandbox.caip2) return true;
  return false;
}

function block(reason: ReasonCode, policyHash: `0x${string}`): SpendDecision {
  return decision("block", reason, REASON_MESSAGES[reason], policyHash);
}

function decision(outcome: SpendDecision["outcome"], reason: ReasonCode, message: string, policyHash: `0x${string}`): SpendDecision {
  return { outcome, reason, message, policyHash };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : REASON_MESSAGES.BLOCK_MALFORMED_REQUEST;
}
