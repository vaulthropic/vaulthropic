/** Canonical JSON: sorted object keys, no insignificant whitespace, integers only. */
export function canonicalJson(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error("Canonical JSON only accepts integers.");
    }
    return String(value);
  }
  if (typeof value === "bigint") {
    throw new Error("Encode bigint values as decimal strings before hashing.");
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringify(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stringify(record[key])}`).join(",")}}`;
  }
  throw new Error("Unsupported canonical JSON value.");
}
