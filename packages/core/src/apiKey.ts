import { parsePositiveInteger } from "./integers.js";
import { normalizePolicy } from "./policy.js";
import type { ReasonCode } from "./reasons.js";
import type { Environment, SpendPolicy } from "./types.js";

export type ApiKeyRecord = {
  hash: string;
  displayPrefix: string;
  environment: Environment;
  policyId: string;
  ceiling: string;
  revoked: boolean;
};

export type IssuedApiKey = {
  /** Shown once. Store only `record` in the console database. */
  token: string;
  record: ApiKeyRecord;
};

export async function issueApiKey(input: {
  policy: SpendPolicy;
  ceiling: string;
}): Promise<IssuedApiKey> {
  const policy = normalizePolicy(input.policy);
  const ceiling = parsePositiveInteger(input.ceiling, "Key ceiling");
  if (ceiling > BigInt(policy.limits.perTransaction)) {
    throw new Error("A key ceiling cannot loosen the per-transaction cap.");
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const prefix = policy.environment === "sandbox" ? "vth_test_" : "vth_live_";
  const token = `${prefix}${base64Url(bytes)}`;
  return {
    token,
    record: {
      hash: await sha256Hex(token),
      displayPrefix: token.slice(0, 16),
      environment: policy.environment,
      policyId: policy.policyId,
      ceiling: ceiling.toString(),
      revoked: false,
    },
  };
}

export function keySpendDenial(
  record: ApiKeyRecord,
  request: { environment: Environment; policyId: string; amount: string },
): ReasonCode | null {
  if (record.revoked) return "BLOCK_KEY_REVOKED";
  if (record.environment !== request.environment) return "BLOCK_SESSION_ENVIRONMENT";
  if (record.policyId !== request.policyId) return "BLOCK_KEY_POLICY";
  const amount = parsePositiveInteger(request.amount, "Amount");
  if (amount > BigInt(record.ceiling)) return "BLOCK_KEY_CEILING";
  return null;
}

export function revokeApiKey(record: ApiKeyRecord): ApiKeyRecord {
  return { ...record, revoked: true };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
