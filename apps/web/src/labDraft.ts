import { examplePolicy } from "@vaulthropic/core";
import type { Environment } from "@vaulthropic/core";
import { minorToUsdc, parseUsdcMinor } from "./lab.js";
import type { LabCeilings, LabInput, LabProtocol } from "./lab.js";

export type LabScenario = "decision" | "replay";

export type LabDraft = {
  environment: Environment;
  protocol: LabProtocol;
  recipient: string;
  endpoint: string;
  epochBudget: string;
  maxPerTx: string;
  stepUp: string;
  ttlSeconds: string;
  maxFeeAmount: string;
  maxFeeBps: string;
  maxGasAmount: string;
  maxCombinedAmount: string;
  amount: string;
  quotedFee: string;
  estimatedGas: string;
  scenario: LabScenario;
};

export type ContradictionKind =
  | "step_up_above_per_tx"
  | "per_tx_above_epoch"
  | "combined_below_total"
  | "ttl_or_allowlist"
  | "fee_ceiling_missing"
  | "gas_ceiling_missing";

export type Contradiction = {
  kind: ContradictionKind;
  severity: "contradiction" | "warning";
  message: string;
};

const MAX_TTL_SECONDS = 366 * 24 * 60 * 60;

export function defaultDraft(environment: Environment): LabDraft {
  const policy = examplePolicy(environment);
  const endpoint = policy.allowlists.endpoints[0] ?? "https://merchant.example";
  return {
    environment,
    protocol: "x402",
    recipient: policy.allowlists.recipients[0] ?? "",
    endpoint: `${endpoint}/quote`,
    epochBudget: "100",
    maxPerTx: "25",
    stepUp: "10",
    ttlSeconds: "86400",
    maxFeeAmount: "",
    maxFeeBps: "",
    maxGasAmount: "",
    maxCombinedAmount: "",
    amount: "1",
    quotedFee: "0",
    estimatedGas: "0",
    scenario: "decision",
  };
}

export function allowlistedRecipient(environment: Environment): string {
  return examplePolicy(environment).allowlists.recipients[0] ?? "";
}

export function findContradictions(draft: LabDraft): Contradiction[] {
  const alerts: Contradiction[] = [];
  const stepUp = parseUsdcMinor(draft.stepUp, false);
  const perTx = parseUsdcMinor(draft.maxPerTx, false);
  const epoch = parseUsdcMinor(draft.epochBudget, false);
  const principal = parseUsdcMinor(draft.amount, false);
  const fee = parseUsdcMinor(draft.quotedFee, true);
  const gas = parseUsdcMinor(draft.estimatedGas, true);

  if (stepUp !== null && perTx !== null && stepUp > perTx) {
    alerts.push({
      kind: "step_up_above_per_tx",
      severity: "contradiction",
      message: `Contradiction: Your step-up threshold (${label(draft.stepUp)} USDC) is higher than your per-transaction cap (${label(draft.maxPerTx)} USDC), so step-up approval will never trigger before a hard block.`,
    });
  }

  if (perTx !== null && epoch !== null && perTx > epoch) {
    alerts.push({
      kind: "per_tx_above_epoch",
      severity: "contradiction",
      message: `Contradiction: Your single-transaction cap (${label(draft.maxPerTx)} USDC) exceeds your entire epoch budget (${label(draft.epochBudget)} USDC).`,
    });
  }

  const combinedText = draft.maxCombinedAmount.trim();
  const combined = combinedText === "" ? null : parseUsdcMinor(combinedText, true);
  if (combinedText !== "" && combined !== null && principal !== null && fee !== null && gas !== null) {
    const total = principal + fee + gas;
    if (combined < total) {
      alerts.push({
        kind: "combined_below_total",
        severity: "contradiction",
        message: `Contradiction: maxCombinedAmount (${label(combinedText)} USDC) is smaller than principal + fee + gas (${minorToUsdc(total)} USDC), which will block valid transactions under your per-tx cap (BLOCK_COMBINED_CEILING).`,
      });
    }
  }

  const ttl = parseTtl(draft.ttlSeconds);
  const recipientOk = sameAddress(draft.recipient, allowlistedRecipient(draft.environment));
  const ttlBad = ttl === null || ttl === 0 || ttl > MAX_TTL_SECONDS;
  if (ttlBad || !recipientOk) alerts.push(ttlOrAllowlist(ttl, ttlBad, recipientOk));

  const feeCeilingSet = draft.maxFeeAmount.trim() !== "" || draft.maxFeeBps.trim() !== "";
  if (fee !== null && fee > 0n && !feeCeilingSet) {
    alerts.push({
      kind: "fee_ceiling_missing",
      severity: "warning",
      message: `Warning: A quoted fee (${label(draft.quotedFee)} USDC) is set and this session has no maxFeeAmount or maxFeeBps. The attempt fails closed (BLOCK_FEE_CEILING).`,
    });
  }

  if (gas !== null && gas > 0n && draft.maxGasAmount.trim() === "") {
    alerts.push({
      kind: "gas_ceiling_missing",
      severity: "warning",
      message: `Warning: Estimated gas (${label(draft.estimatedGas)} USDC) is set and this session has no maxGasAmount. The attempt fails closed (BLOCK_GAS_CEILING).`,
    });
  }

  return alerts;
}

export function fixContradiction(draft: LabDraft, kind: ContradictionKind): LabDraft {
  if (kind === "step_up_above_per_tx") {
    const stepUp = parseUsdcMinor(draft.stepUp, false);
    const perTx = parseUsdcMinor(draft.maxPerTx, false);
    if (stepUp !== null && perTx !== null && stepUp > perTx) return { ...draft, stepUp: draft.maxPerTx.trim() };
    return draft;
  }
  if (kind === "per_tx_above_epoch") {
    const perTx = parseUsdcMinor(draft.maxPerTx, false);
    const epoch = parseUsdcMinor(draft.epochBudget, false);
    const stepUp = parseUsdcMinor(draft.stepUp, false);
    if (perTx === null || epoch === null || perTx <= epoch) return draft;
    const next = { ...draft, maxPerTx: draft.epochBudget.trim() };
    if (stepUp !== null && stepUp > epoch) next.stepUp = draft.epochBudget.trim();
    return next;
  }
  if (kind === "combined_below_total") return raiseCombined(draft);
  if (kind === "ttl_or_allowlist") return fixTtlAndRecipient(draft);
  if (kind === "fee_ceiling_missing") return { ...draft, maxFeeAmount: draft.quotedFee.trim() };
  return { ...draft, maxGasAmount: draft.estimatedGas.trim() };
}

export function draftToInput(draft: LabDraft): LabInput {
  const ceilings: LabCeilings = {};
  if (draft.maxPerTx.trim() !== "") ceilings.maxPerTxUsdc = draft.maxPerTx.trim();
  if (draft.epochBudget.trim() !== "") ceilings.epochBudgetUsdc = draft.epochBudget.trim();
  if (draft.stepUp.trim() !== "") ceilings.stepUpUsdc = draft.stepUp.trim();
  const ttl = parseTtl(draft.ttlSeconds);
  if (ttl !== null) ceilings.ttlSeconds = ttl;
  else if (draft.ttlSeconds.trim() !== "") ceilings.ttlSeconds = -1;
  if (draft.maxFeeAmount.trim() !== "") ceilings.maxFeeAmountUsdc = draft.maxFeeAmount.trim();
  if (draft.maxFeeBps.trim() !== "") ceilings.maxFeeBps = Number(draft.maxFeeBps.trim());
  if (draft.maxGasAmount.trim() !== "") ceilings.maxGasAmountUsdc = draft.maxGasAmount.trim();
  if (draft.maxCombinedAmount.trim() !== "") ceilings.maxCombinedAmountUsdc = draft.maxCombinedAmount.trim();
  return {
    protocol: draft.protocol,
    environment: draft.environment,
    amountUsdc: draft.amount.trim(),
    recipient: draft.recipient.trim(),
    endpoint: draft.endpoint.trim(),
    ceilings,
    quotedFeeUsdc: draft.quotedFee.trim(),
    estimatedGasUsdc: draft.estimatedGas.trim(),
    scenario: draft.scenario,
  };
}

function raiseCombined(draft: LabDraft): LabDraft {
  const principal = parseUsdcMinor(draft.amount, false);
  const fee = parseUsdcMinor(draft.quotedFee, true);
  const gas = parseUsdcMinor(draft.estimatedGas, true);
  if (principal === null || fee === null || gas === null) return draft;
  const total = principal + fee + gas;
  const totalText = minorToUsdc(total);
  const next: LabDraft = { ...draft, maxCombinedAmount: totalText };
  const epoch = parseUsdcMinor(draft.epochBudget, false);
  if (epoch !== null && total > epoch) {
    next.epochBudget = totalText;
    const perTx = parseUsdcMinor(draft.maxPerTx, false);
    if (perTx !== null && perTx > total) next.maxPerTx = totalText;
    const stepUp = parseUsdcMinor(next.stepUp, false);
    const cappedPerTx = parseUsdcMinor(next.maxPerTx, false);
    if (stepUp !== null && cappedPerTx !== null && stepUp > cappedPerTx) next.stepUp = next.maxPerTx;
  }
  return next;
}

function fixTtlAndRecipient(draft: LabDraft): LabDraft {
  const ttl = parseTtl(draft.ttlSeconds);
  const ttlBad = ttl === null || ttl === 0 || ttl > MAX_TTL_SECONDS;
  const recipientOk = sameAddress(draft.recipient, allowlistedRecipient(draft.environment));
  return {
    ...draft,
    ...(ttlBad ? { ttlSeconds: "86400" } : {}),
    ...(recipientOk ? {} : { recipient: allowlistedRecipient(draft.environment) }),
  };
}

function ttlOrAllowlist(ttl: number | null, ttlBad: boolean, recipientOk: boolean): Contradiction {
  const ttlZero = ttl === 0;
  let message: string;
  if (ttlZero && !recipientOk) {
    message = "Warning: Session TTL is 0s or the recipient is not on the allowlist. Every request fails closed (BLOCK_SESSION_EXPIRED when the session TTL has elapsed, BLOCK_DEADLINE_EXCEEDED when the payment deadline is past the session, or BLOCK_RECIPIENT_NOT_ALLOWLISTED).";
  } else if (ttlZero) {
    message = "Warning: Session TTL is 0s. Every request fails closed (BLOCK_SESSION_EXPIRED). A payment deadline past that expiry is BLOCK_DEADLINE_EXCEEDED.";
  } else if (ttlBad && !recipientOk) {
    message = "Warning: Session TTL is empty, unreadable, or above 366 days, and the recipient is not on the allowlist. Every request fails closed.";
  } else if (ttlBad) {
    message = "Warning: Session TTL is empty, unreadable, or above 366 days. The session cannot be evaluated until it is a whole number of seconds from 1 through 366 days.";
  } else {
    message = "Warning: This recipient is not on the allowlist. Every request fails closed (BLOCK_RECIPIENT_NOT_ALLOWLISTED).";
  }
  return { kind: "ttl_or_allowlist", severity: "warning", message };
}

function parseTtl(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}

function sameAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function label(value: string): string {
  return value.trim();
}
