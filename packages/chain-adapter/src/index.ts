import { createEvmAdapter } from "./evm.js";
import { createMppRailAdapter } from "./mppRail.js";
import { createSolanaAdapter } from "./solana.js";
import type { AdapterHost } from "./adapter.js";
import type { ChainAdapter } from "./types.js";
import { catalogEntry } from "./catalog.js";

export { createRailAdapter } from "./adapter.js";
export type { AdapterHost, RailKind } from "./adapter.js";
export { asSettlementRef } from "./adapter.js";
export { ADAPTER_CATALOG, catalogEntry, v1SettlementChains } from "./catalog.js";
export type { AdapterCatalogEntry, AdapterKind, AdapterWave } from "./catalog.js";
export { createBaseAdapter, createBaseSepoliaAdapter, createEvmAdapter } from "./evm.js";
export type { EvmAdapterOptions } from "./evm.js";
export { createMppRailAdapter } from "./mppRail.js";
export type { MppRailOptions } from "./mppRail.js";
export { normalizeAdapterProtocol } from "./protocol.js";
export { createSolanaAdapter } from "./solana.js";
export type { SolanaAdapterOptions } from "./solana.js";
export type {
  AdapterPoll,
  AdapterProtocolName,
  ChainAdapter,
  ExecutionReceipt,
  InclusionReport,
  QuoteEstimate,
  SequenceLease,
  SequenceMode,
  SolanaBlockhashLease,
  SolanaBlockhashSource,
} from "./types.js";

/** Builds the catalog adapter. Solana still needs `host.recentBlockhash` before acquireSequence can lease one. */
export function createCatalogAdapter(adapterId: string, host: AdapterHost): ChainAdapter {
  const entry = catalogEntry(adapterId);
  if (!entry) throw new Error("Unknown adapter.");
  if (entry.kind === "evm") return createEvmAdapter(host, { adapterId: entry.adapterId, supportedChains: entry.chains });
  if (entry.kind === "solana") return createSolanaAdapter(host, { adapterId: entry.adapterId, supportedChains: entry.chains });
  return createMppRailAdapter(host, { adapterId: entry.adapterId, supportedChains: entry.chains });
}
