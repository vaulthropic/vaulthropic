import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLA_ACCEPTANCE_COMMENT,
  CLA_ACCEPTANCE_PATTERN,
  CLA_STATUS_CONTEXT,
  CLA_VERSION,
  DEFAULT_BOT_ALLOWLIST,
  acceptanceRegExp,
  addSignature,
  evaluateCla,
  isExactAcceptance,
  reminderBody,
  statusContext,
} from "./cla-gate.mjs";

const author = "octocat";

test("accepts the CLA sentence with an optional trailing period", () => {
  assert.equal(CLA_ACCEPTANCE_COMMENT.endsWith("."), false);
  assert.equal(CLA_ACCEPTANCE_PATTERN, "^I have read and agree to the terms of CLA\\.md\\.?$");
  assert.equal(acceptanceRegExp().source, CLA_ACCEPTANCE_PATTERN);
  assert.equal(isExactAcceptance(`\n${CLA_ACCEPTANCE_COMMENT}\n`), true);
  assert.equal(isExactAcceptance(`${CLA_ACCEPTANCE_COMMENT}.`), true);
  assert.equal(isExactAcceptance(CLA_ACCEPTANCE_COMMENT.toLowerCase()), true);
  assert.equal(isExactAcceptance("I   HAVE\nread and agree to the terms of CLA.md."), true);
  assert.equal(isExactAcceptance(`${CLA_ACCEPTANCE_COMMENT} Thanks`), false);
  assert.equal(isExactAcceptance("I have read and agree to the terms of CLA.md. Thanks"), false);
  assert.equal(isExactAcceptance(`${CLA_ACCEPTANCE_COMMENT}..`), false);
});

test("allowlists dependabot and requires the current CLA version", () => {
  assert.deepEqual(
    evaluateCla({ author: "dependabot[bot]", signatures: [], comments: [] }),
    { state: "success", reason: "allowlisted-bot" },
  );
  assert.ok(DEFAULT_BOT_ALLOWLIST.includes("dependabot[bot]"));

  const signed = evaluateCla({
    author,
    signatures: [{ login: author, claVersion: CLA_VERSION }],
    comments: [],
  });
  assert.equal(signed.reason, "signed");

  const stale = evaluateCla({
    author,
    signatures: [{ login: author, claVersion: "old" }],
    comments: [],
    claVersion: CLA_VERSION,
  });
  assert.equal(stale.reason, "missing-acceptance");
});

test("counts only the pull request author's exact comment", () => {
  const missing = evaluateCla({
    author,
    signatures: [],
    comments: [{ login: "someone-else", body: CLA_ACCEPTANCE_COMMENT, id: 1, createdAt: "2026-11-24T00:00:00Z" }],
  });
  assert.equal(missing.state, "failure");

  const accepted = evaluateCla({
    author,
    signatures: [],
    comments: [{ login: author, body: CLA_ACCEPTANCE_COMMENT, id: 9, createdAt: "2026-11-24T00:00:00Z" }],
  });
  assert.equal(accepted.reason, "comment-accepted");
  assert.equal(accepted.signature.commentId, 9);

  const withoutPeriod = evaluateCla({
    author,
    signatures: [],
    comments: [{ login: author, body: "i have read and agree to the terms of cla.md", id: 10, createdAt: "2026-11-24T00:00:00Z" }],
  });
  assert.equal(withoutPeriod.reason, "comment-accepted");
  const stored = addSignature({ claVersion: CLA_VERSION, signatures: [] }, accepted.signature);
  assert.equal(stored.added, true);
  assert.equal(addSignature(stored.doc, accepted.signature).added, false);
});

test("the public files and the signature log use the same acceptance sentence", () => {
  for (const file of ["CLA.md", "CONTRIBUTING.md", ".github/PULL_REQUEST_TEMPLATE.md"]) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes(`\`${CLA_ACCEPTANCE_COMMENT}\``), true, file);
    assert.equal(text.includes(`\`${CLA_ACCEPTANCE_COMMENT}.\``), false, file);
  }
  const log = JSON.parse(readFileSync("signatures/cla.json", "utf8"));
  assert.equal(log.claVersion, CLA_VERSION);
  assert.deepEqual(log.allowlistedBots, ["dependabot[bot]"]);
  assert.equal(reminderBody().includes(CLA_ACCEPTANCE_COMMENT), true);

  const workflow = readFileSync(".github/workflows/cla.yml", "utf8");
  assert.match(workflow, /vars\.CLA_GATE_ENABLED == 'true'/);
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /issue_comment:/);
  assert.match(workflow, /types:\s*\[created\]/);
  assert.match(workflow, /github\.event\.issue\.pull_request/);
  assert.match(workflow, /github\.event\.repository\.default_branch/);
  assert.match(workflow, /CLA_STATUS_CONTEXT: Vaulthropic CLA/);
  assert.equal(
    workflow.includes(`CLA_ACCEPTANCE_PATTERN: '${CLA_ACCEPTANCE_PATTERN}'`),
    true,
  );
  assert.equal(/^ {2}pull_request:/m.test(workflow), false);
  assert.equal(workflow.includes("github.event.pull_request.head"), false);
  assert.equal(CLA_STATUS_CONTEXT, "Vaulthropic CLA");
  assert.equal(statusContext(), "Vaulthropic CLA");
  const previous = process.env.CLA_STATUS_CONTEXT;
  process.env.CLA_STATUS_CONTEXT = "some other check";
  assert.throws(() => statusContext(), /Vaulthropic CLA/);
  if (previous === undefined) delete process.env.CLA_STATUS_CONTEXT;
  else process.env.CLA_STATUS_CONTEXT = previous;
});
