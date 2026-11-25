import type { Protocol } from "@vaulthropic/core";
import type { AdapterProtocolName } from "./types.js";

const PROTOCOLS = new Set<Protocol>(["x402", "ap2", "mpp", "mcp", "onchain"]);

export function normalizeAdapterProtocol(value: AdapterProtocolName | string): Protocol | undefined {
  const lowered = value.toLowerCase();
  return PROTOCOLS.has(lowered as Protocol) ? (lowered as Protocol) : undefined;
}
