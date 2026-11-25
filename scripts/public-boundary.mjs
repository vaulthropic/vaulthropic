/**
 * Shared rules for the public-repo boundary.
 * Restricted directories may exist on disk. They must not be tracked or staged.
 */

const RESTRICTED_DIRS = new Set([
  "private",
  "general",
  "business",
  "pricing",
  "internal",
  "secrets",
  "ops",
]);

/** Local notes that sit beside the public docs and must not be tracked. */
const LOCAL_DOCS = new Set([
  "docs/ACCESS-AND-SECRETS.md",
  "docs/COMMERCIAL-GOVERNANCE.md",
  "docs/COMPLIANCE-GOVERNANCE.md",
  "docs/OPERATIONS-RUNBOOK.md",
  "docs/PRODUCT-BLUEPRINT.md",
  "docs/RISK-REGISTER.md",
  "docs/ROADMAP.md",
  "docs/VENDOR-MANAGEMENT.md",
  "docs/AUDIT-ASSURANCE.md",
  "docs/COMPLIANCE.md",
  "docs/DATA-PROTECTION.md",
  "docs/INCIDENT-RESPONSE.md",
  "docs/RISK-CONTROLS.md",
  "docs/RELEASES.md",
  "scripts/init-private-workspace.sh",
]);

const SECRET_RULES = [
  ["pem-private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["github-token", /\bghp_[A-Za-z0-9]{36}\b/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["stripe-live-key", /\bsk_live_[0-9a-zA-Z]{10,}/],
  [
    "assigned-private-key",
    /(?:private[_-]?key|secret[_-]?key)\s*[:=]\s*['"]?(?:0x)?[a-fA-F0-9]{64}\b/i,
  ],
  [
    "assigned-mnemonic",
    /(?:mnemonic|seed(?:\s+phrase)?)\s*[:=]\s*['"][a-z]+(?:\s+[a-z]+){11,23}['"]/i,
  ],
  [
    "assigned-api-secret",
    /(?:api[_-]?key|api[_-]?secret|auth[_-]?token)\s*[:=]\s*['"][^'"\n]{20,}['"]/i,
  ],
];

export function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

export function pathDenial(filePath) {
  const p = normalizePath(filePath);
  if (!p || p.startsWith("../")) return null;
  if (p === "AGENTS.md" || p === "img-board" || p.startsWith("img-board/") || LOCAL_DOCS.has(p)) {
    return { rule: "local-documentation", path: p };
  }
  const segments = p.split("/");
  if (segments.some((segment) => RESTRICTED_DIRS.has(segment))) {
    return { rule: "restricted-directory", path: p };
  }
  const base = segments.at(-1) ?? p;
  if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) {
    return { rule: "env-file", path: p };
  }
  if (/\.(pem|key|p12|pfx|keystore|jks|sqlite|sqlite3|db)$/i.test(base)) {
    return { rule: "sensitive-file", path: p };
  }
  if (/^id_(rsa|ed25519|ecdsa|dsa)$/.test(base)) {
    return { rule: "ssh-key", path: p };
  }
  return null;
}

export function secretFindings(filename, text) {
  const path = normalizePath(filename);
  if (path.endsWith(".env.example")) return [];
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const [rule, pattern] of SECRET_RULES) {
      if (pattern.test(line)) {
        findings.push({ rule, path, line: index + 1 });
      }
    }
  }
  return findings;
}

export function isTextPath(filePath) {
  return !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|wasm|mp4)$/i.test(filePath);
}
