import { keccak256, toBytes } from "viem";
import { normalizeAddress } from "./address.js";
import { canonicalJson } from "./canonical.js";
import { REFERENCE_CHAINS } from "./chains.js";
import { normalizeEndpoint } from "./endpoint.js";
import { parseNonNegativeInteger, parsePositiveInteger } from "./integers.js";
import type { AnchorDraft, AssetId, SpendPolicy } from "./types.js";

const MAX_EPOCH_SECONDS = 366 * 24 * 60 * 60;
const ZERO_HASH = `0x${"00".repeat(32)}` as const;

export function normalizePolicy(policy: SpendPolicy): SpendPolicy {
  if (policy.version !== "1") throw new Error("Unsupported policy version.");
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(policy.policyId)) throw new Error("Invalid policy id.");
  if (policy.environment !== "sandbox" && policy.environment !== "mainnet") {
    throw new Error("Environment must be sandbox or mainnet.");
  }
  if (!Array.isArray(policy.chains) || policy.chains.length === 0) throw new Error("A policy needs a chain.");

  const chains = [...new Set(policy.chains.map(normalizeChain))];
  if (policy.environment === "sandbox" && chains.includes(REFERENCE_CHAINS.mainnet.caip2)) {
    throw new Error("A sandbox policy cannot list Base mainnet.");
  }
  if (policy.environment === "mainnet" && chains.includes(REFERENCE_CHAINS.sandbox.caip2)) {
    throw new Error("A mainnet policy cannot list Base Sepolia.");
  }

  const eip155 = chains.some((chain) => chain.startsWith("eip155:"));
  const account = eip155 ? normalizeAddress(policy.account) : requireToken(policy.account, "Account");
  const assets = normalizeAssets(policy.assets, chains, eip155);
  const limits = normalizeLimits(policy.limits);
  const recipients = normalizeRecipients(policy.allowlists?.recipients, eip155);
  const endpoints = normalizeEndpoints(policy.allowlists?.endpoints);
  const mcp = normalizeMcp(policy.allowlists?.mcp);
  const mandates = policy.mandates;
  if (!mandates || typeof mandates.requireIntentForAutonomous !== "boolean") {
    throw new Error("Mandate settings are required.");
  }
  if (!Number.isInteger(mandates.maxMandateTtlSeconds) || mandates.maxMandateTtlSeconds <= 0 || mandates.maxMandateTtlSeconds > MAX_EPOCH_SECONDS) {
    throw new Error("Mandate TTL is out of range.");
  }
  if (!Number.isInteger(policy.session?.validUntil) || policy.session.validUntil <= 0) {
    throw new Error("Session expiry is required.");
  }
  if (typeof policy.session.paused !== "boolean") throw new Error("Session pause flag is required.");

  return {
    version: "1",
    policyId: policy.policyId,
    account,
    environment: policy.environment,
    chains,
    assets,
    limits,
    allowlists: { recipients, endpoints, mcp },
    mandates: {
      requireIntentForAutonomous: mandates.requireIntentForAutonomous,
      maxMandateTtlSeconds: mandates.maxMandateTtlSeconds,
    },
    session: {
      signer: eip155 ? normalizeAddress(policy.session.signer) : requireToken(policy.session.signer, "Session signer"),
      validUntil: policy.session.validUntil,
      paused: policy.session.paused,
    },
  };
}

export function policyHash(policy: SpendPolicy): `0x${string}` {
  return keccak256(toBytes(canonicalJson(normalizePolicy(policy))));
}

export function policyHashOrZero(policy: SpendPolicy): `0x${string}` {
  try {
    return policyHash(policy);
  } catch {
    return ZERO_HASH;
  }
}

/** Fields that must match the reference PolicyAnchor. Fails closed for multi-chain documents. */
export function anchorDraft(policy: SpendPolicy): AnchorDraft {
  const normalized = normalizePolicy(policy);
  const reference = REFERENCE_CHAINS[normalized.environment];
  if (normalized.chains.length !== 1 || normalized.chains[0] !== reference.caip2) {
    throw new Error(`The reference anchor settles ${reference.name} (${reference.caip2}) only.`);
  }
  if (normalized.assets.length !== 1) {
    throw new Error("The reference anchor commits one asset.");
  }
  const asset = normalized.assets[0];
  if (!asset) throw new Error("The reference anchor commits one asset.");
  return {
    policyHash: keccak256(toBytes(canonicalJson(normalized))),
    sessionSigner: normalized.session.signer as `0x${string}`,
    asset: asset.asset as `0x${string}`,
    validUntil: normalized.session.validUntil,
    epochSeconds: normalized.limits.epochSeconds,
    perTxCap: BigInt(normalized.limits.perTransaction),
    epochCap: BigInt(normalized.limits.perEpoch),
    stepUpAbove: BigInt(normalized.limits.stepUpAbove),
    recipients: normalized.allowlists.recipients as `0x${string}`[],
  };
}

export function examplePolicy(environment: SpendPolicy["environment"] = "sandbox"): SpendPolicy {
  const reference = REFERENCE_CHAINS[environment];
  return normalizePolicy({
    version: "1",
    policyId: environment === "sandbox" ? "example-sandbox" : "example-mainnet",
    account: "0x1111111111111111111111111111111111111111",
    environment,
    chains: [reference.caip2],
    assets: [{ chain: reference.caip2, asset: reference.usdc, symbol: "USDC", decimals: 6 }],
    limits: {
      perTransaction: "25000000",
      perEpoch: "100000000",
      epochSeconds: 86_400,
      stepUpAbove: "10000000",
    },
    allowlists: {
      recipients: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
      endpoints: ["https://merchant.example"],
      mcp: [{ server: "https://mcp.example.com", tools: ["search", "quote"] }],
    },
    mandates: { requireIntentForAutonomous: true, maxMandateTtlSeconds: 86_400 },
    session: {
      signer: "0x3333333333333333333333333333333333333333",
      validUntil: 1_893_456_000,
      paused: false,
    },
  });
}

function normalizeChain(chain: string): string {
  if (!/^[a-z0-9]+:[A-Za-z0-9._:-]+$/.test(chain)) throw new Error(`Invalid chain id "${chain}".`);
  return chain;
}

function normalizeAssets(assets: AssetId[] | undefined, chains: string[], eip155: boolean): AssetId[] {
  if (!assets || assets.length === 0) throw new Error("A policy needs an asset.");
  const seen = new Set<string>();
  const normalized = assets.map((asset) => {
    if (!chains.includes(asset.chain)) throw new Error("Asset chain is not on the policy.");
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36) {
      throw new Error("Asset decimals are out of range.");
    }
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(asset.symbol)) throw new Error("Invalid asset symbol.");
    const address = eip155 ? normalizeAddress(asset.asset) : requireToken(asset.asset, "Asset");
    const key = `${asset.chain}:${address}`;
    if (seen.has(key)) throw new Error("Duplicate asset.");
    seen.add(key);
    return { chain: asset.chain, asset: address, symbol: asset.symbol.toUpperCase(), decimals: asset.decimals };
  });
  normalized.sort((a, b) => `${a.chain}:${a.asset}`.localeCompare(`${b.chain}:${b.asset}`));
  return normalized;
}

function normalizeLimits(limits: SpendPolicy["limits"]): SpendPolicy["limits"] {
  const perTransaction = parsePositiveInteger(limits?.perTransaction ?? "", "Per-transaction cap");
  const perEpoch = parsePositiveInteger(limits?.perEpoch ?? "", "Epoch cap");
  const stepUpAbove = parsePositiveInteger(limits?.stepUpAbove ?? "", "Step-up threshold");
  if (perEpoch < perTransaction || stepUpAbove > perTransaction) {
    throw new Error("Caps must satisfy step-up <= per-transaction <= epoch.");
  }
  if (!Number.isInteger(limits.epochSeconds) || limits.epochSeconds < 60 || limits.epochSeconds > MAX_EPOCH_SECONDS) {
    throw new Error("Epoch length must be between 60 seconds and 366 days.");
  }
  const maxFeeAmount = optionalMinor(limits.maxFeeAmount, "Fee ceiling");
  const maxGasAmount = optionalMinor(limits.maxGasAmount, "Gas ceiling");
  const maxCombinedAmount = optionalPositive(limits.maxCombinedAmount, "Combined ceiling");
  if (maxCombinedAmount !== undefined && BigInt(maxCombinedAmount) > perEpoch) {
    throw new Error("Combined ceiling cannot exceed the epoch cap.");
  }
  let maxFeeBps: number | undefined;
  if (limits.maxFeeBps !== undefined) {
    if (!Number.isInteger(limits.maxFeeBps) || limits.maxFeeBps < 0 || limits.maxFeeBps > 10_000) {
      throw new Error("Fee ceiling basis points must be an integer from 0 through 10000.");
    }
    maxFeeBps = limits.maxFeeBps;
  }
  return {
    perTransaction: perTransaction.toString(),
    perEpoch: perEpoch.toString(),
    epochSeconds: limits.epochSeconds,
    stepUpAbove: stepUpAbove.toString(),
    ...(maxFeeAmount === undefined ? {} : { maxFeeAmount }),
    ...(maxFeeBps === undefined ? {} : { maxFeeBps }),
    ...(maxGasAmount === undefined ? {} : { maxGasAmount }),
    ...(maxCombinedAmount === undefined ? {} : { maxCombinedAmount }),
  };
}

function optionalMinor(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  return parseNonNegativeInteger(value, label).toString();
}

function optionalPositive(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  return parsePositiveInteger(value, label).toString();
}

function normalizeRecipients(recipients: string[] | undefined, eip155: boolean): string[] {
  if (!recipients || recipients.length === 0) throw new Error("Recipient allowlist is fail-closed and cannot be empty.");
  if (recipients.length > 64) throw new Error("Recipient allowlist is capped at 64 entries.");
  const normalized = recipients.map((recipient) => (eip155 ? normalizeAddress(recipient) : requireToken(recipient, "Recipient")));
  if (new Set(normalized).size !== normalized.length) throw new Error("Duplicate recipient.");
  normalized.sort();
  return normalized;
}

function normalizeEndpoints(endpoints: string[] | undefined): string[] {
  if (!endpoints) throw new Error("Endpoint allowlist is required.");
  const normalized = endpoints.map((endpoint) => normalizeEndpoint(endpoint));
  return [...new Set(normalized)].sort();
}

function normalizeMcp(entries: SpendPolicy["allowlists"]["mcp"] | undefined): SpendPolicy["allowlists"]["mcp"] {
  if (!entries) throw new Error("MCP allowlist is required.");
  const normalized = entries.map((entry) => {
    const server = normalizeEndpoint(entry.server);
    if (!entry.tools || entry.tools.length === 0) throw new Error("An MCP server needs at least one tool.");
    const tools = [...new Set(entry.tools.map((tool) => {
      if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(tool)) throw new Error("Invalid MCP tool name.");
      return tool;
    }))].sort();
    return { server, tools };
  });
  const servers = normalized.map((entry) => entry.server);
  if (new Set(servers).size !== servers.length) throw new Error("Duplicate MCP server.");
  normalized.sort((a, b) => a.server.localeCompare(b.server));
  return normalized;
}

function requireToken(value: string, label: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}
