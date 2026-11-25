import { getAddress } from "viem";

export function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function normalizeAddress(value: string): `0x${string}` {
  if (!isHexAddress(value)) {
    throw new Error("Expected a 20-byte hex address.");
  }
  return value.toLowerCase() as `0x${string}`;
}

export function checksumAddress(value: string): `0x${string}` {
  return getAddress(normalizeAddress(value));
}
