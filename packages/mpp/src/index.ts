import { evaluateSpend, normalizePolicy, policyHashOrZero } from "@vaulthropic/core";
import type { EpochUsage, SpendDecision, SpendPolicy } from "@vaulthropic/core";

export type MppRequest = {
  amount: string;
  currency: string;
  recipient: string;
  chain?: string;
};

export type MppChallenge = {
  id: string;
  method: string;
  intent: string;
  request: string;
  realm?: string;
  expires?: string;
  decodedRequest: MppRequest;
};

export type MppCredential = {
  challenge: { id: string; method: string; intent: string; request: string };
  payload: { type: "hash"; hash: string };
};

export type MppReceipt = {
  method?: string;
  reference: string;
  status: string;
  timestamp?: string;
};

export type MppGate = SpendDecision & { challenge?: MppChallenge };

export function parseChallenge(header: string): MppChallenge {
  let value = header.trim().replace(/^WWW-Authenticate:\s*/i, "");
  if (!/^Payment\b/i.test(value)) throw new Error("Header is not a Payment challenge.");
  value = value.replace(/^Payment\s*/i, "");
  const params = parseAuthParams(value);
  if (!params.id || !params.method || !params.intent || !params.request) {
    throw new Error("Payment challenge is missing id, method, intent, or request.");
  }
  const decoded = JSON.parse(decodeBase64Url(params.request)) as unknown;
  if (!decoded || typeof decoded !== "object") throw new Error("Payment request is not an object.");
  const request = decoded as Record<string, unknown>;
  if (typeof request.amount !== "string" || typeof request.currency !== "string" || typeof request.recipient !== "string") {
    throw new Error("Payment request needs amount, currency, and recipient.");
  }
  return {
    id: params.id,
    method: params.method,
    intent: params.intent,
    request: params.request,
    ...(params.realm ? { realm: params.realm } : {}),
    ...(params.expires ? { expires: params.expires } : {}),
    decodedRequest: {
      amount: request.amount,
      currency: request.currency,
      recipient: request.recipient,
      ...(typeof request.chain === "string" ? { chain: request.chain } : {}),
    },
  };
}

export function evaluateMpp(input: {
  policy: SpendPolicy;
  usage: EpochUsage;
  challenge: MppChallenge;
  chain: string;
  now: number;
  endpoint?: string;
  stepUpSatisfied?: boolean;
  /** Platform fee quoted beside the merchant amount. Evaluated against the session fee ceiling before a credential can be built. */
  quotedFeeAmount?: string;
  /** Sponsored gas reimbursement quoted for this payment, in asset minor units. */
  maxGasFee?: string;
}): MppGate {
  let policy: SpendPolicy;
  try {
    policy = normalizePolicy(input.policy);
  } catch (error) {
    return {
      outcome: "block",
      reason: "BLOCK_MALFORMED_REQUEST",
      message: error instanceof Error ? error.message : "Malformed policy.",
      policyHash: policyHashOrZero(input.policy),
    };
  }
  if (input.challenge.expires && Date.parse(input.challenge.expires) <= input.now * 1000) {
    return {
      outcome: "block",
      reason: "BLOCK_MANDATE_EXPIRED",
      message: "The payment challenge has expired.",
      policyHash: policyHashOrZero(policy),
      challenge: input.challenge,
    };
  }
  const request = input.challenge.decodedRequest;
  const decision = evaluateSpend({
    policy,
    usage: input.usage,
    stepUpSatisfied: input.stepUpSatisfied,
    request: {
      protocol: "mpp",
      environment: policy.environment,
      chain: request.chain ?? input.chain,
      asset: request.currency,
      recipient: request.recipient,
      amount: request.amount,
      now: input.now,
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      ...(input.quotedFeeAmount === undefined ? {} : { quotedFeeAmount: input.quotedFeeAmount }),
      ...(input.maxGasFee === undefined ? {} : { maxGasFee: input.maxGasFee }),
    },
  });
  return { ...decision, challenge: input.challenge };
}

/** Builds an MPP credential only after an allow. The hash is the caller's settlement receipt, not a Vaulthropic signature. */
export function buildMppCredential(input: { challenge: MppChallenge; decision: SpendDecision; txHash: string }): MppCredential {
  if (input.decision.outcome !== "allow") {
    throw new Error("Refusing to build a payment credential without an allow decision.");
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) throw new Error("Settlement reference must be a 32-byte hex hash.");
  return {
    challenge: {
      id: input.challenge.id,
      method: input.challenge.method,
      intent: input.challenge.intent,
      request: input.challenge.request,
    },
    payload: { type: "hash", hash: input.txHash },
  };
}

export function encodeCredential(credential: MppCredential): string {
  return `Payment ${encodeBase64Url(JSON.stringify(credential))}`;
}

export function parseReceipt(header: string): MppReceipt {
  const value = header.trim().replace(/^Payment-Receipt:\s*/i, "");
  const decoded = JSON.parse(decodeBase64Url(value)) as unknown;
  if (!decoded || typeof decoded !== "object") throw new Error("Payment receipt is not an object.");
  const receipt = decoded as Record<string, unknown>;
  if (typeof receipt.reference !== "string" || typeof receipt.status !== "string") {
    throw new Error("Payment receipt needs reference and status.");
  }
  return {
    reference: receipt.reference,
    status: receipt.status,
    ...(typeof receipt.method === "string" ? { method: receipt.method } : {}),
    ...(typeof receipt.timestamp === "string" ? { timestamp: receipt.timestamp } : {}),
  };
}

export function receiptBindsTx(receipt: MppReceipt, txHash: string): boolean {
  return receipt.status === "success" && receipt.reference.toLowerCase() === txHash.toLowerCase();
}

function parseAuthParams(input: string): Record<string, string> {
  const params: Record<string, string> = {};
  const pattern = /([A-Za-z0-9_-]+)=(?:"([^"]*)"|([^\s,]+))/g;
  for (const match of input.matchAll(pattern)) {
    const key = match[1];
    if (!key) continue;
    params[key] = match[2] ?? match[3] ?? "";
  }
  return params;
}

function decodeBase64Url(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
