import { createRailAdapter } from "./adapter.js";
import type { AdapterHost } from "./adapter.js";
import type { ChainAdapter } from "./types.js";

export type MppRailOptions = {
  adapterId?: string;
  supportedChains?: readonly string[];
};

/**
 * HTTP 402 challenge rail.
 * The challenge id is `endpointOrMandateRef`. A credential that is not already a settlement ref is hashed for the ledger.
 * Credential construction stays in `@vaulthropic/mpp`. This module does not import it.
 */
export function createMppRailAdapter(host: AdapterHost, options: MppRailOptions = {}): ChainAdapter {
  const supportedChains = options.supportedChains ?? ["mpp:tempo"];
  if (supportedChains.length === 0) throw new Error("An MPP rail adapter needs a rail id.");
  return createRailAdapter({
    adapterId: options.adapterId ?? "mpp-tempo",
    supportedChains,
    kind: "mpp-rail",
    host,
    protocols: ["x402", "mpp"],
  });
}
