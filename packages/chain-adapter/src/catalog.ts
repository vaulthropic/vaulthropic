export type AdapterWave = "v1" | "wave-2" | "wave-3";
export type AdapterKind = "evm" | "solana" | "mpp-rail";

/**
 * Public chain catalog.
 * v1 selector rows are Base and Base Sepolia only.
 * Later rows name a CAIP-2 id or rail id and a symbol. They do not publish token addresses, RPC URLs, or bytecode.
 */
export type AdapterCatalogEntry = {
  adapterId: string;
  kind: AdapterKind;
  wave: AdapterWave;
  chains: readonly string[];
  label: string;
  assetSymbol: string;
  /** Every rail defaults to irreversible finality. Fast inclusion is a host opt-in. */
  finality: "irreversible";
  note: string;
};

export const ADAPTER_CATALOG: readonly AdapterCatalogEntry[] = [
  {
    adapterId: "base",
    kind: "evm",
    wave: "v1",
    chains: ["eip155:8453"],
    label: "Base",
    assetSymbol: "USDC",
    finality: "irreversible",
    note: "v1 settlement target. Deployment files stay not-deployed until bytecode is verified.",
  },
  {
    adapterId: "base-sepolia",
    kind: "evm",
    wave: "v1",
    chains: ["eip155:84532"],
    label: "Base Sepolia",
    assetSymbol: "USDC",
    finality: "irreversible",
    note: "v1 sandbox target. USDC for this chain lives on the reference chain table, 6 decimals.",
  },
  {
    adapterId: "arbitrum",
    kind: "evm",
    wave: "wave-2",
    chains: ["eip155:42161"],
    label: "Arbitrum One",
    assetSymbol: "USDC",
    finality: "irreversible",
    note: "Same EVM adapter and ceiling path. A policy may name this chain. The v1 selector does not.",
  },
  {
    adapterId: "polygon",
    kind: "evm",
    wave: "wave-2",
    chains: ["eip155:137"],
    label: "Polygon",
    assetSymbol: "USDC",
    finality: "irreversible",
    note: "Same EVM adapter and ceiling path. A policy may name this chain. The v1 selector does not.",
  },
  {
    adapterId: "bsc",
    kind: "evm",
    wave: "wave-3",
    chains: ["eip155:56"],
    label: "BNB Smart Chain",
    assetSymbol: "USDC",
    finality: "irreversible",
    note: "Same EVM adapter. Native gas is BNB. This catalog does not publish a token address.",
  },
  {
    adapterId: "ethereum",
    kind: "evm",
    wave: "wave-3",
    chains: ["eip155:1"],
    label: "Ethereum",
    assetSymbol: "USDC",
    finality: "irreversible",
    note: "Same EVM adapter. Suited to higher-value settlements that wait for FINALIZED.",
  },
  {
    adapterId: "solana",
    kind: "solana",
    wave: "wave-3",
    chains: ["solana:mainnet"],
    label: "Solana",
    assetSymbol: "USDC",
    finality: "irreversible",
    note: "Recent-blockhash lease. This repository has no Solana program and holds no fee-payer key.",
  },
  {
    adapterId: "solana-devnet",
    kind: "solana",
    wave: "wave-3",
    chains: ["solana:devnet"],
    label: "Solana Devnet",
    assetSymbol: "USDC",
    finality: "irreversible",
    note: "Sandbox blockhash lease. This repository has no Solana program.",
  },
  {
    adapterId: "mpp-tempo",
    kind: "mpp-rail",
    wave: "wave-3",
    chains: ["mpp:tempo"],
    label: "Tempo",
    assetSymbol: "USDC",
    finality: "irreversible",
    note: "HTTP 402 credential rail. mpp:tempo is a rail id, not a v1 selector row. This adapter does not build credentials.",
  },
];

/** Chains that belong in the v1 network selector. */
export function v1SettlementChains(): readonly string[] {
  return ADAPTER_CATALOG.filter((entry) => entry.wave === "v1").flatMap((entry) => [...entry.chains]);
}

export function catalogEntry(adapterId: string): AdapterCatalogEntry | undefined {
  return ADAPTER_CATALOG.find((entry) => entry.adapterId === adapterId);
}
