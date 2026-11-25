import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function listedFiles(staged) {
  const output = staged
    ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    : git(["ls-files"]);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}
