import { canonicalJson, evaluateSpend, normalizeAddress, normalizePolicy, policyHashOrZero, parseNonNegativeInteger } from "@vaulthropic/core";
import type { EpochUsage, SpendDecision, SpendPolicy } from "@vaulthropic/core";
import { keccak256, toBytes } from "viem";

/** Launch names. AP2 v0.2 aliases: intent ≈ open checkout, cart ≈ closed checkout. */
export type MandateType = "intent" | "cart" | "payment";

export type Mandate = {
  mandateType: MandateType;
  vct?: string;
  id: string;
  payer: string;
  payee?: string;
  merchant?: string;
  merchants?: string[];
  amount?: { value: string; currency: string };
  issuedAt: number;
  expiresAt: number;
  cartHash?: string;
  nonce: string;
  signature?: string;
};

export interface MandateSignatureVerifier {
  verify(mandate: Mandate): boolean;
}

/** Checks that a signature field is present. Production hosts must supply an SD-JWT verifier. */
export class PresenceVerifier implements MandateSignatureVerifier {
  verify(mandate: Mandate): boolean {
    return typeof mandate.signature === "string" && mandate.signature.length >= 16;
  }
}

export type Ap2Gate = SpendDecision & { cartCommitment?: `0x${string}` };

export function cartCommitment(cart: Mandate): `0x${string}` {
  const { signature: _signature, cartHash: _cartHash, ...body } = cart;
  return keccak256(toBytes(canonicalJson(body)));
}

export function evaluateAp2(input: {
  policy: SpendPolicy;
  usage: EpochUsage;
  chain: string;
  now: number;
  payment: Mandate;
  intent?: Mandate;
  cart?: Mandate;
  endpoint?: string;
  stepUpSatisfied?: boolean;
  /** Platform fee quoted beside the cart amount. The intent ceiling must cover the payment plus this fee and gas. */
  quotedFeeAmount?: string;
  /** Sponsored gas reimbursement quoted for this payment, in asset minor units. */
  maxGasFee?: string;
  signatures: MandateSignatureVerifier;
}): Ap2Gate {
  let policy: SpendPolicy;
  try {
    policy = normalizePolicy(input.policy);
  } catch (error) {
    return malformed(input.policy, error instanceof Error ? error.message : "Malformed policy.");
  }
  const hash = policyHashOrZero(policy);
  const fail = (reason: SpendDecision["reason"], message: string): Ap2Gate => ({
    outcome: "block",
    reason,
    message,
    policyHash: hash,
  });

  if (input.payment.mandateType !== "payment") return fail("BLOCK_MALFORMED_REQUEST", "A payment mandate is required.");
  if (policy.mandates.requireIntentForAutonomous && !input.intent) {
    return fail("BLOCK_MANDATE_MISSING", "Autonomous settlement requires an intent mandate.");
  }
  if (input.intent && input.intent.mandateType !== "intent") return fail("BLOCK_MALFORMED_REQUEST", "Intent mandate type is wrong.");
  if (input.cart && input.cart.mandateType !== "cart") return fail("BLOCK_MALFORMED_REQUEST", "Cart mandate type is wrong.");

  for (const mandate of [input.intent, input.cart, input.payment]) {
    if (!mandate) continue;
    if (!fresh(mandate, input.now, policy.mandates.maxMandateTtlSeconds)) {
      return fail("BLOCK_MANDATE_EXPIRED", "A mandate is outside its validity window.");
    }
    if (!input.signatures.verify(mandate)) return fail("BLOCK_MANDATE_SIGNATURE", "A mandate signature did not verify.");
  }

  const paymentAmount = input.payment.amount;
  const payee = input.payment.payee;
  if (!paymentAmount || !payee) return fail("BLOCK_MALFORMED_REQUEST", "Payment mandate needs an amount and payee.");
  let surcharge = 0n;
  try {
    surcharge = quotedMinor(input.quotedFeeAmount, "Quoted fee") + quotedMinor(input.maxGasFee, "Gas budget");
  } catch (error) {
    return fail("BLOCK_MALFORMED_REQUEST", error instanceof Error ? error.message : "Quoted fee or gas budget is not an integer.");
  }
  if (input.intent?.amount) {
    if (input.intent.amount.currency.toUpperCase() !== paymentAmount.currency.toUpperCase()) {
      return fail("BLOCK_MANDATE_AMOUNT", "Payment currency is outside the intent mandate.");
    }
    try {
      if (BigInt(paymentAmount.value) + surcharge > BigInt(input.intent.amount.value)) {
        return fail("BLOCK_MANDATE_AMOUNT", "The payment total is above the intent mandate.");
      }
    } catch {
      return fail("BLOCK_MALFORMED_REQUEST", "Mandate amount is not an integer.");
    }
  }
  if (input.intent?.merchants && input.intent.merchants.length > 0) {
    const allowed = new Set(input.intent.merchants.map(identity));
    if (!allowed.has(identity(payee)) && !(input.payment.merchant && allowed.has(identity(input.payment.merchant)))) {
      return fail("BLOCK_MANDATE_PAYEE", "Payee is outside the intent mandate.");
    }
  }

  let commitment: `0x${string}` | undefined;
  if (input.cart) {
    if (!input.cart.amount || input.cart.amount.value !== paymentAmount.value || input.cart.amount.currency.toUpperCase() !== paymentAmount.currency.toUpperCase()) {
      return fail("BLOCK_CART_MISMATCH", "Cart amount does not match the payment mandate.");
    }
    if (!input.cart.payee || identity(input.cart.payee) !== identity(payee)) {
      return fail("BLOCK_MANDATE_PAYEE", "Cart payee does not match the payment mandate.");
    }
    commitment = cartCommitment(input.cart);
    if (input.payment.cartHash !== commitment) return fail("BLOCK_CART_MISMATCH", "Payment mandate does not bind the cart commitment.");
  }

  const asset = resolveAsset(policy, input.chain, paymentAmount.currency);
  if (!asset) return fail("BLOCK_ASSET_NOT_ALLOWLISTED", "Mandate currency is not on this policy.");
  const decision = evaluateSpend({
    policy,
    usage: input.usage,
    stepUpSatisfied: input.stepUpSatisfied,
    request: {
      protocol: "ap2",
      environment: policy.environment,
      chain: input.chain,
      asset,
      recipient: payee,
      amount: paymentAmount.value,
      now: input.now,
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      ...(input.quotedFeeAmount === undefined ? {} : { quotedFeeAmount: input.quotedFeeAmount }),
      ...(input.maxGasFee === undefined ? {} : { maxGasFee: input.maxGasFee }),
    },
  });
  return commitment ? { ...decision, cartCommitment: commitment } : decision;
}

function quotedMinor(value: string | undefined, label: string): bigint {
  if (value === undefined) return 0n;
  return parseNonNegativeInteger(value, label);
}

function fresh(mandate: Mandate, now: number, maxTtl: number): boolean {
  if (!Number.isInteger(mandate.issuedAt) || !Number.isInteger(mandate.expiresAt)) return false;
  if (mandate.issuedAt > now || mandate.expiresAt <= now) return false;
  return mandate.expiresAt - mandate.issuedAt <= maxTtl && mandate.expiresAt > mandate.issuedAt;
}

function resolveAsset(policy: SpendPolicy, chain: string, currency: string): string | undefined {
  if (/^0x[a-fA-F0-9]{40}$/.test(currency)) return normalizeAddress(currency);
  return policy.assets.find((asset) => asset.chain === chain && asset.symbol === currency.toUpperCase())?.asset;
}

function identity(value: string): string {
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : value;
}

function malformed(policy: SpendPolicy, message: string): Ap2Gate {
  return { outcome: "block", reason: "BLOCK_MALFORMED_REQUEST", message, policyHash: policyHashOrZero(policy) };
}
