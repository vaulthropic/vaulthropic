import type { Environment } from "./types.js";

/** Reference settlement rails for the v1 contracts. Other CAIP-2 ids can be named in a policy, but the anchor draft accepts only these. */
export const REFERENCE_CHAINS = {
  sandbox: {
    caip2: "eip155:84532",
    chainId: 84532,
    name: "Base Sepolia",
    usdc: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  },
  mainnet: {
    caip2: "eip155:8453",
    chainId: 8453,
    name: "Base",
    usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
} as const;

export function referenceChain(environment: Environment) {
  return REFERENCE_CHAINS[environment];
}

export function chainIdFromCaip2(chain: string): number {
  const match = /^eip155:([1-9][0-9]*)$/.exec(chain);
  if (!match) throw new Error("Expected an eip155 CAIP-2 chain id.");
  return Number(match[1]);
}
