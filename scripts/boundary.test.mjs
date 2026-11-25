import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathDenial, secretFindings } from "./public-boundary.mjs";

test("allows public source and the env template", () => {
  assert.equal(pathDenial("docs/ARCHITECTURE.md"), null);
  assert.equal(pathDenial("docs/README.md"), null);
  assert.equal(pathDenial("docs/USER-GUIDE.md"), null);
  assert.equal(pathDenial("contracts/src/PolicyAnchor.sol"), null);
  assert.equal(pathDenial(".env.example"), null);
  assert.equal(pathDenial("packages/core/src/index.ts"), null);
});

test("rejects restricted trees, env files, and key material", () => {
  assert.equal(pathDenial("AGENTS.md")?.rule, "local-documentation");
  assert.equal(pathDenial("img-board/ai.png")?.rule, "local-documentation");
  assert.equal(pathDenial("docs/PRODUCT-BLUEPRINT.md")?.rule, "local-documentation");
  assert.equal(pathDenial("docs/AUDIT-ASSURANCE.md")?.rule, "local-documentation");
  assert.equal(pathDenial("docs/COMPLIANCE.md")?.rule, "local-documentation");
  assert.equal(pathDenial("docs/DATA-PROTECTION.md")?.rule, "local-documentation");
  assert.equal(pathDenial("docs/INCIDENT-RESPONSE.md")?.rule, "local-documentation");
  assert.equal(pathDenial("docs/RISK-CONTROLS.md")?.rule, "local-documentation");
  assert.equal(pathDenial("docs/RELEASES.md")?.rule, "local-documentation");
  assert.equal(pathDenial("scripts/init-private-workspace.sh")?.rule, "local-documentation");
  assert.equal(pathDenial("docs/COMMERCIAL-GOVERNANCE.md")?.rule, "local-documentation");
  assert.equal(pathDenial("docs/ACCESS-AND-SECRETS.md")?.rule, "local-documentation");
  assert.equal(pathDenial("docs/ROADMAP.md")?.rule, "local-documentation");
  assert.equal(pathDenial("private/business/pricing.md")?.rule, "restricted-directory");
  assert.equal(pathDenial("business/go-to-market.md")?.rule, "restricted-directory");
  assert.equal(pathDenial("pricing/take-rate.json")?.rule, "restricted-directory");
  assert.equal(pathDenial("internal/admin/index.ts")?.rule, "restricted-directory");
  assert.equal(pathDenial("ops/rpc.env")?.rule, "restricted-directory");
  assert.equal(pathDenial("apps/web/secrets/token.txt")?.rule, "restricted-directory");
  assert.equal(pathDenial("contracts/private/note.md")?.rule, "restricted-directory");
  assert.equal(pathDenial("packages/core/general/notes.md")?.rule, "restricted-directory");
  assert.equal(pathDenial(".env")?.rule, "env-file");
  assert.equal(pathDenial("apps/web/.env.local")?.rule, "env-file");
  assert.equal(pathDenial("certs/server.pem")?.rule, "sensitive-file");
  assert.equal(pathDenial("id_ed25519")?.rule, "ssh-key");
});

test("flags assigned secrets without flagging public hashes", () => {
  const keyLine = `const privateKey = "0x${"ab".repeat(32)}"`;
  assert.equal(secretFindings("src/wallet.ts", keyLine).length, 1);

  const hashLine = `const policyHash = "0x${"ab".repeat(32)}"`;
  assert.equal(secretFindings("src/policy.ts", hashLine).length, 0);

  const pem = `block ${"-----BEGIN "}${"PRIVATE KEY-----"} trailer`;
  assert.equal(secretFindings("notes.txt", pem)[0]?.rule, "pem-private-key");

  const mnemonic = `mnemonic = "${["test"].concat(Array.from({ length: 11 }, () => "word")).join(" ")}"`;
  assert.equal(secretFindings("src/x.ts", mnemonic)[0]?.rule, "assigned-mnemonic");
});

test("brand tokens stay on harbor and verdigris", () => {
  const css = readFileSync("brand/colors.css", "utf8").toLowerCase();
  assert.match(css, /#0c3b4c/);
  assert.match(css, /#176b57/);
  for (const banned of ["#d4a27f", "#cc785c", "#c15f3c", "#d97757", "#faf9f5"]) {
    assert.equal(css.includes(banned), false);
  }
  const mark = readFileSync("brand/logo.svg", "utf8");
  const publicMark = readFileSync("apps/web/public/mark.svg", "utf8");
  assert.equal(mark, publicMark);
});

test("does not scan the env template", () => {
  const line = `DEPLOYER_PRIVATE_KEY=0x${"11".repeat(32)}`;
  assert.equal(secretFindings(".env.example", line).length, 0);
});
