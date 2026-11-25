import { pathDenial } from "./public-boundary.mjs";
import { listedFiles } from "./git-files.mjs";

const staged = process.argv.includes("--staged");
const files = listedFiles(staged);
const denials = files.map(pathDenial).filter(Boolean);

if (denials.length === 0) {
  process.exit(0);
}

console.error("Boundary check failed. These paths cannot be committed:");
for (const denial of denials) {
  console.error(`  ${denial.path} [${denial.rule}]`);
}
process.exit(1);
