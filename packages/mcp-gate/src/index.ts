import { endpointAllowed, evaluateSpend, normalizeEndpoint, normalizePolicy, policyHashOrZero } from "@vaulthropic/core";
import type { EpochUsage, SpendDecision, SpendPolicy } from "@vaulthropic/core";

export type McpToolCall = {
  server: string;
  tool: string;
  arguments?: Record<string, unknown>;
};

export function gateMcpToolCall(input: {
  policy: SpendPolicy;
  usage: EpochUsage;
  call: McpToolCall;
  chain: string;
  now: number;
  stepUpSatisfied?: boolean;
}): SpendDecision {
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

  let server: string;
  try {
    server = normalizeEndpoint(input.call.server);
  } catch {
    return block(policy, "BLOCK_MCP_SERVER_NOT_ALLOWLISTED", "The MCP server URL is invalid.");
  }
  const entry = policy.allowlists.mcp.find((candidate) => candidate.server === server);
  if (!entry) return block(policy, "BLOCK_MCP_SERVER_NOT_ALLOWLISTED", "The MCP server is not on this policy.");
  if (!entry.tools.includes(input.call.tool)) {
    return block(policy, "BLOCK_MCP_TOOL_NOT_ALLOWLISTED", "The MCP tool is not on this policy.");
  }

  const spend = readSpend(input.call.arguments);
  if (spend.kind === "none") {
    return {
      outcome: "allow",
      reason: "ALLOW_WITHIN_POLICY",
      message: "The tool is allowlisted and declares no spend.",
      policyHash: policyHashOrZero(policy),
    };
  }
  if (spend.kind === "endpoint") {
    if (!endpointAllowed(policy.allowlists.endpoints, spend.endpoint)) {
      return block(policy, "BLOCK_ENDPOINT_NOT_ALLOWLISTED", "The tool endpoint is not on this policy.");
    }
    return {
      outcome: "allow",
      reason: "ALLOW_WITHIN_POLICY",
      message: "The tool is allowlisted and its endpoint is on this policy.",
      policyHash: policyHashOrZero(policy),
    };
  }
  if (spend.kind === "partial") {
    return block(policy, "BLOCK_MALFORMED_REQUEST", "The tool call declares an incomplete payment.");
  }

  return evaluateSpend({
    policy,
    usage: input.usage,
    stepUpSatisfied: input.stepUpSatisfied,
    request: {
      protocol: "mcp",
      environment: policy.environment,
      chain: spend.chain ?? input.chain,
      asset: spend.asset ?? policy.assets.find((asset) => asset.chain === input.chain)?.asset ?? "",
      recipient: spend.recipient,
      amount: spend.amount,
      now: input.now,
      ...(spend.endpoint ? { endpoint: spend.endpoint } : {}),
      ...(spend.quotedFeeAmount ? { quotedFeeAmount: spend.quotedFeeAmount } : {}),
      ...(spend.maxGasFee ? { maxGasFee: spend.maxGasFee } : {}),
    },
  });
}

type SpendShape =
  | { kind: "none" }
  | { kind: "partial" }
  | { kind: "endpoint"; endpoint: string }
  | {
      kind: "spend";
      amount: string;
      recipient: string;
      asset?: string;
      chain?: string;
      endpoint?: string;
      quotedFeeAmount?: string;
      maxGasFee?: string;
    };

function readSpend(args: Record<string, unknown> | undefined): SpendShape {
  if (!args) return { kind: "none" };
  const amount = stringField(args, ["amount", "value", "maxAmountRequired"]);
  const recipient = stringField(args, ["to", "recipient", "payTo"]);
  const asset = stringField(args, ["asset", "currency"]);
  const chain = stringField(args, ["chain", "network"]);
  const endpoint = stringField(args, ["url", "endpoint", "resource"]);
  const quotedFeeAmount = stringField(args, ["quotedFeeAmount", "feeAmount"]);
  const maxGasFee = stringField(args, ["maxGasFee", "gasBudget"]);
  if (!amount && !recipient && !asset) {
    return endpoint ? { kind: "endpoint", endpoint } : { kind: "none" };
  }
  if (!amount || !recipient) return { kind: "partial" };
  return {
    kind: "spend",
    amount,
    recipient,
    ...(asset ? { asset } : {}),
    ...(chain ? { chain } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(quotedFeeAmount ? { quotedFeeAmount } : {}),
    ...(maxGasFee ? { maxGasFee } : {}),
  };
}

function stringField(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function block(policy: SpendPolicy, reason: SpendDecision["reason"], message: string): SpendDecision {
  return { outcome: "block", reason, message, policyHash: policyHashOrZero(policy) };
}
