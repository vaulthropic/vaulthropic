export function parsePositiveInteger(value: string, label: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive base-10 integer string.`);
  }
  return BigInt(value);
}

export function parseNonNegativeInteger(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a non-negative base-10 integer string.`);
  }
  return BigInt(value);
}
