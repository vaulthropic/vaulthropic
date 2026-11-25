import { readFileSync, statSync } from "node:fs";
import { secretFindings, isTextPath } from "./public-boundary.mjs";
import { listedFiles } from "./git-files.mjs";

const staged = process.argv.includes("--staged");
const files = listedFiles(staged).filter(isTextPath);
const findings = [];

for (const file of files) {
  let info;
  try {
    info = statSync(file);
  } catch {
    continue;
  }
  if (!info.isFile() || info.size > 1_000_000) continue;
  const text = readFileSync(file, "utf8");
  if (text.includes("\u0000")) continue;
  findings.push(...secretFindings(file, text));
}

if (findings.length === 0) {
  process.exit(0);
}

console.error("Secret scan failed. Commit blocked:");
for (const finding of findings) {
  console.error(`  ${finding.path}:${finding.line} [${finding.rule}]`);
}
console.error("Remove the credential and rotate it if it was ever real. Do not commit a redacted copy of the same value.");
process.exit(1);
