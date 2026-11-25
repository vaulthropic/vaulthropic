import { AttemptLedger, chainIdFromCaip2, evaluateSpend, normalizeAddress, normalizePolicy, policyHashOrZero } from "@vaulthropic/core";
import type { EpochUsage, SpendDecision, SpendPolicy } from "@vaulthropic/core";

export type X402Resource = {
  url: string;
  description?: string;
  mimeType?: string;
};

export type X402Accept = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};

export type X402Required = {
  x402Version: number;
  error?: string;
  resource?: X402Resource;
  accepts: X402Accept[];
};

export type Eip3009Authorization = {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
};

export type Eip3009TypedData = {
  domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
  types: {
    TransferWithAuthorization: Array<{ name: string; type: string }>;
  };
  primaryType: "TransferWithAuthorization";
  message: Eip3009Authorization;
};

export type X402Gate = SpendDecision & {
  accept?: X402Accept;
  /**
   * Present only from releaseX402Authorization after this realm's ledger has reserved the attempt.
   * evaluateX402 does not return it. A block, a step-up, or a second process sharing the budget never returns it.
   */
  authorization?: Eip3009Authorization;
  typedData?: Eip3009TypedData;
};

export function parsePaymentRequired(headerValue: string): X402Required {
  const payload = decodeHeaderJson(headerValue, "PAYMENT-REQUIRED");
  if (!payload || typeof payload !== "object") throw new Error("PAYMENT-REQUIRED payload is not an object.");
  const record = payload as Record<string, unknown>;
  if (record.x402Version !== 2) throw new Error("This adapter accepts x402 version 2.");
  if (!Array.isArray(record.accepts) || record.accepts.length === 0) throw new Error("PAYMENT-REQUIRED has no accepts.");
  const accepts = record.accepts.map(parseAccept);
  const resource = parseResource(record.resource);
  return {
    x402Version: 2,
    ...(typeof record.error === "string" ? { error: record.error } : {}),
    ...(resource ? { resource } : {}),
    accepts,
  };
}

export function evaluateX402(input: {
  policy: SpendPolicy;
  usage: EpochUsage;
  required: X402Required;
  now: number;
  stepUpSatisfied?: boolean;
  /** Platform fee quoted beside the merchant amount. Evaluated against the session fee ceiling. The authorization is still withheld until release. */
  quotedFeeAmount?: string;
  /** Sponsored gas reimbursement quoted for this payment, in asset minor units. */
  maxGasFee?: string;
}): X402Gate {
  let policy: SpendPolicy;
  try {
    policy = normalizePolicy(input.policy);
  } catch (error) {
    return malformed(input.policy, error instanceof Error ? error.message : "Malformed policy.");
  }
  if (input.required.x402Version !== 2) return malformed(policy, "PAYMENT-REQUIRED must be x402 version 2.");

  const endpoint = input.required.resource?.url;
  const choice = chooseAccept(input.required.accepts, policy);
  if (!choice) {
    return {
      outcome: "block",
      reason: "BLOCK_CHAIN_NOT_ALLOWLISTED",
      message: "No x402 exact requirement matches this policy chain and asset.",
      policyHash: policyHashOrZero(policy),
    };
  }

  const decision = evaluateSpend({
    policy,
    usage: input.usage,
    stepUpSatisfied: input.stepUpSatisfied,
    request: {
      protocol: "x402",
      environment: policy.environment,
      chain: choice.network,
      asset: choice.asset,
      recipient: choice.payTo,
      amount: choice.amount,
      now: input.now,
      ...(endpoint ? { endpoint } : {}),
      ...(input.quotedFeeAmount === undefined ? {} : { quotedFeeAmount: input.quotedFeeAmount }),
      ...(input.maxGasFee === undefined ? {} : { maxGasFee: input.maxGasFee }),
    },
  });
  return { ...decision, accept: choice };
}

/**
 * Returns the unsigned EIP-3009 payload for one reservation in this JavaScript realm.
 * A second ledger does not have the reservation, so it cannot release a payload.
 * `processes` other than 1 throws: a shared budget needs one serializable store first.
 */
export function releaseX402Authorization(input: {
  ledger: AttemptLedger;
  idempotencyKey: string;
  policy: SpendPolicy;
  required: X402Required;
  now: number;
  nonce?: `0x${string}`;
  quotedFeeAmount?: string;
  maxGasFee?: string;
  processes?: number;
}): X402Gate {
  if ((input.processes ?? 1) !== 1 || input.ledger.isolation !== "javascript-realm") {
    throw new Error("One serializable store has to reserve this budget before more than one host process can release an EIP-3009 payload.");
  }
  let policy: SpendPolicy;
  try {
    policy = normalizePolicy(input.policy);
  } catch (error) {
    return malformed(input.policy, error instanceof Error ? error.message : "Malformed policy.");
  }
  if (input.required.x402Version !== 2) return malformed(policy, "PAYMENT-REQUIRED must be x402 version 2.");
  const choice = chooseAccept(input.required.accepts, policy);
  if (!choice) return withheld(policy, "No x402 exact requirement matches this policy chain and asset.");
  const record = input.ledger.get(input.idempotencyKey);
  if (!record || record.outcome !== "allow" || record.status !== "CREATED" || record.protocol !== "x402") {
    return withheld(policy, "EIP-3009 stays withheld until this ledger reserves the attempt.");
  }
  if (record.policyHash !== policyHashOrZero(policy) || record.chain !== choice.network) {
    return withheld(policy, "The reservation does not match this x402 requirement.");
  }
  if (!sameMinor(record.principal, choice.amount) || !sameMinor(record.quotedFeeAmount, input.quotedFeeAmount) || !sameMinor(record.maxGasFee, input.maxGasFee)) {
    return withheld(policy, "The reservation does not match this x402 amount.");
  }
  if (normalizeMaybe(record.asset) !== normalizeMaybe(choice.asset) || normalizeMaybe(record.recipient) !== normalizeMaybe(choice.payTo)) {
    return withheld(policy, "The reservation does not match this x402 payee.");
  }
  try {
    const nonce = (input.ledger.boundPayloadNonce(input.idempotencyKey) ?? input.nonce ?? randomNonce()) as `0x${string}`;
    const bound = input.ledger.claimPayloadNonce(input.idempotencyKey, nonce) as `0x${string}`;
    const authorization = buildAuthorization(policy, choice, input.now, bound);
    const typedData = buildTypedData(choice, authorization);
    return {
      outcome: "allow",
      reason: record.reason,
      message: record.message,
      policyHash: record.policyHash,
      accept: choice,
      authorization,
      ...(typedData ? { typedData } : {}),
    };
  } catch (error) {
    return withheld(policy, error instanceof Error ? error.message : "EIP-3009 stays withheld.");
  }
}

export function encodePaymentSignature(payload: unknown): string {
  return encodeBase64(JSON.stringify(payload));
}

function chooseAccept(accepts: X402Accept[], policy: SpendPolicy): X402Accept | undefined {
  return accepts.find((accept) => {
    if (accept.scheme !== "exact") return false;
    if (!policy.chains.includes(accept.network)) return false;
    return policy.assets.some((asset) => asset.chain === accept.network && asset.asset === normalizeMaybe(accept.asset));
  });
}

function buildAuthorization(
  policy: SpendPolicy,
  accept: X402Accept,
  now: number,
  nonce: `0x${string}` | undefined,
): Eip3009Authorization {
  const window = Math.min(accept.maxTimeoutSeconds, 300);
  if (!Number.isInteger(window) || window <= 0) throw new Error("x402 maxTimeoutSeconds is invalid.");
  return {
    from: normalizeAddress(policy.account),
    to: normalizeAddress(accept.payTo),
    value: accept.amount,
    validAfter: "0",
    validBefore: String(now + window),
    nonce: nonce ?? randomNonce(),
  };
}

function buildTypedData(accept: X402Accept, authorization: Eip3009Authorization): Eip3009TypedData | undefined {
  const name = accept.extra?.name;
  const version = accept.extra?.version;
  if (typeof name !== "string" || typeof version !== "string" || !name || !version) return undefined;
  return {
    domain: {
      name,
      version,
      chainId: chainIdFromCaip2(accept.network),
      verifyingContract: normalizeAddress(accept.asset),
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: authorization,
  };
}

function parseAccept(value: unknown): X402Accept {
  if (!value || typeof value !== "object") throw new Error("x402 accept entry is malformed.");
  const accept = value as Record<string, unknown>;
  if (typeof accept.scheme !== "string" || typeof accept.network !== "string") throw new Error("x402 accept entry is malformed.");
  if (typeof accept.amount !== "string" || typeof accept.asset !== "string" || typeof accept.payTo !== "string") {
    throw new Error("x402 accept entry is malformed.");
  }
  if (typeof accept.maxTimeoutSeconds !== "number") throw new Error("x402 accept entry is malformed.");
  return {
    scheme: accept.scheme,
    network: accept.network,
    amount: accept.amount,
    asset: accept.asset,
    payTo: accept.payTo,
    maxTimeoutSeconds: accept.maxTimeoutSeconds,
    ...(accept.extra && typeof accept.extra === "object" ? { extra: accept.extra as Record<string, unknown> } : {}),
  };
}

function parseResource(value: unknown): X402Resource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const resource = value as Record<string, unknown>;
  if (typeof resource.url !== "string") return undefined;
  return {
    url: resource.url,
    ...(typeof resource.description === "string" ? { description: resource.description } : {}),
    ...(typeof resource.mimeType === "string" ? { mimeType: resource.mimeType } : {}),
  };
}

function withheld(policy: SpendPolicy, message: string): X402Gate {
  return { outcome: "block", reason: "BLOCK_MALFORMED_REQUEST", message, policyHash: policyHashOrZero(policy) };
}

function sameMinor(reserved: string, quoted: string | undefined): boolean {
  return BigInt(reserved) === BigInt(quoted ?? "0");
}

function malformed(policy: SpendPolicy, message: string): X402Gate {
  return {
    outcome: "block",
    reason: "BLOCK_MALFORMED_REQUEST",
    message,
    policyHash: policyHashOrZero(policy),
  };
}

function normalizeMaybe(asset: string): string {
  return /^0x[a-fA-F0-9]{40}$/.test(asset) ? normalizeAddress(asset) : asset;
}

function randomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function decodeHeaderJson(value: string, headerName: string): unknown {
  let body = value.trim();
  const prefix = new RegExp(`^${headerName}:\\s*`, "i");
  body = body.replace(prefix, "");
  if (body.startsWith("{")) return JSON.parse(body) as unknown;
  return JSON.parse(decodeBase64(body)) as unknown;
}

function decodeBase64(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
