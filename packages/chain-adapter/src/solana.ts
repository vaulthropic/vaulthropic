import { createRailAdapter } from "./adapter.js";
import type { AdapterHost } from "./adapter.js";
import type { ChainAdapter } from "./types.js";

const DEFAULT_CHAINS = ["solana:mainnet", "solana:devnet"] as const;

export type SolanaAdapterOptions = {
  adapterId?: string;
  supportedChains?: readonly string[];
};

/**
 * Solana attempt boundary.
 * `acquireSequence` leases a host-supplied recent blockhash. There is no program, fee-payer key, or RPC URL here.
 * A missing blockhash is BLOCK_NONCE_UNAVAILABLE. Expiry releases the reservation so a retry can reserve again.
 */
export function createSolanaAdapter(host: AdapterHost, options: SolanaAdapterOptions = {}): ChainAdapter {
  const supportedChains = options.supportedChains ?? DEFAULT_CHAINS;
  if (supportedChains.length === 0 || supportedChains.some((chain) => !chain.startsWith("solana:"))) {
    throw new Error("A Solana adapter supports solana chains.");
  }
  return createRailAdapter({
    adapterId: options.adapterId ?? "solana",
    supportedChains,
    kind: "solana",
    host,
  });
}
