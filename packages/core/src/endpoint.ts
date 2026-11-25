export function normalizeEndpoint(value: string): string {
  const url = new URL(value);
  if (url.username || url.password) {
    throw new Error("Endpoint must not include userinfo.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Endpoint protocol is not allowed.");
  }
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}${url.search}`;
}

export function endpointAllowed(allowlist: readonly string[], endpoint: string): boolean {
  let target: string;
  try {
    target = normalizeEndpoint(endpoint);
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    try {
      const prefix = normalizeEndpoint(entry);
      return target === prefix || target.startsWith(`${prefix}/`) || target.startsWith(`${prefix}?`);
    } catch {
      return false;
    }
  });
}
