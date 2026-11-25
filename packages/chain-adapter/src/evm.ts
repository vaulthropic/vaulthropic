import { createRailAdapter } from "./adapter.js";
import type { AdapterHost } from "./adapter.js";
import type { ChainAdapter } from "./types.js";

export type EvmAdapterOptions = {
  adapterId: string;
  supportedChains: readonly string[];
};

/** Shared EVM adapter. Nonce comes from AttemptLedger.setSignerNonce. This module does not open an RPC connection. */
export function createEvmAdapter(host: AdapterHost, options: EvmAdapterOptions): ChainAdapter {
  if (options.supportedChains.length === 0 || options.supportedChains.some((chain) => !/^eip155:[1-9][0-9]*$/.test(chain))) {
    throw new Error("An EVM adapter supports eip155 chains.");
  }
  return createRailAdapter({
    adapterId: options.adapterId,
    supportedChains: options.supportedChains,
    kind: "evm",
    host,
  });
}

export function createBaseAdapter(host: AdapterHost): ChainAdapter {
  return createEvmAdapter(host, { adapterId: "base", supportedChains: ["eip155:8453"] });
}

export function createBaseSepoliaAdapter(host: AdapterHost): ChainAdapter {
  return createEvmAdapter(host, { adapterId: "base-sepolia", supportedChains: ["eip155:84532"] });
}
