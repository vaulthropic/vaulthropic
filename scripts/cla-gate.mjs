/**
 * Pull-request CLA gate.
 * The workflow calls this file only after CLA_GATE_ENABLED=true.
 * It reads signatures from the default branch and never executes pull-request code.
 */
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CLA_ACCEPTANCE_COMMENT = "I have read and agree to the terms of CLA.md.";
export const CLA_VERSION = "1";
export const DEFAULT_BOT_ALLOWLIST = ["dependabot[bot]"];
export const REMINDER_MARKER = "<!-- vaulthropic-cla -->";

export function normalizeComment(body) {
  return String(body ?? "").replaceAll("\r\n", "\n").trim();
}

export function isExactAcceptance(body) {
  return normalizeComment(body) === CLA_ACCEPTANCE_COMMENT;
}

export function allowlistFor(doc) {
  const extra = Array.isArray(doc?.allowlistedBots) ? doc.allowlistedBots : [];
  return [...new Set([...DEFAULT_BOT_ALLOWLIST, ...extra.filter((name) => typeof name === "string" && name.length > 0)])];
}

export function evaluateCla({ author, signatures, comments, allowlist, claVersion }) {
  if (!author) return { state: "failure", reason: "missing-author" };
  const bots = new Set(allowlist ?? DEFAULT_BOT_ALLOWLIST);
  if (bots.has(author)) return { state: "success", reason: "allowlisted-bot" };
  const version = claVersion ?? CLA_VERSION;
  const prior = (signatures ?? []).find((entry) => entry?.login === author && entry?.claVersion === version);
  if (prior) return { state: "success", reason: "signed" };
  const match = (comments ?? []).find((comment) => comment?.login === author && isExactAcceptance(comment.body));
  if (!match) return { state: "failure", reason: "missing-acceptance" };
  return {
    state: "success",
    reason: "comment-accepted",
    signature: {
      login: author,
      claVersion: version,
      agreement: "CLA.md",
      commentId: match.id ?? null,
      signedAt: match.createdAt ?? null,
    },
  };
}

export function addSignature(doc, signature) {
  const signatures = Array.isArray(doc.signatures) ? [...doc.signatures] : [];
  const exists = signatures.some((entry) => entry.login === signature.login && entry.claVersion === signature.claVersion);
  if (exists) return { doc, added: false };
  return { doc: { ...doc, signatures: [...signatures, signature] }, added: true };
}

export function reminderBody() {
  return [
    REMINDER_MARKER,
    "",
    "This pull request is missing the acceptance of CLA.md.",
    "",
    "Comment this exact sentence, with no other text:",
    "",
    `\`${CLA_ACCEPTANCE_COMMENT}\``,
    "",
    "A recorded acceptance grants no compensation. dependabot[bot] is allowlisted.",
  ].join("\n");
}

export function statusDescription(result) {
  const descriptions = {
    "allowlisted-bot": "Allowlisted bot. No CLA comment required.",
    signed: "CLA acceptance is on file for this version.",
    "comment-accepted": "CLA acceptance comment recorded.",
    "missing-acceptance": "Comment the exact CLA acceptance sentence.",
    "missing-author": "Pull request author is missing.",
  };
  return descriptions[result.reason] ?? "CLA check failed.";
}

function runningAsCli() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

async function github(token, route, options = {}) {
  const response = await fetch(`https://api.github.com${route}`, {
    method: options.method ?? "GET",
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "vaulthropic-cla-gate",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const error = new Error(`GitHub ${options.method ?? "GET"} ${route} returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function readLocalSignatures() {
  const file = new URL("../signatures/cla.json", import.meta.url);
  return JSON.parse(readFileSync(file, "utf8"));
}

async function loadSignatures(token, repository, branch) {
  try {
    const payload = await github(
      token,
      `/repos/${repository}/contents/signatures/cla.json?ref=${encodeURIComponent(branch)}`,
    );
    return {
      doc: JSON.parse(Buffer.from(payload.content, "base64").toString("utf8")),
      sha: payload.sha,
    };
  } catch (error) {
    if (error.status === 404) return { doc: readLocalSignatures(), sha: undefined };
    throw error;
  }
}

async function loadPullRequest(token, repository, eventName, event) {
  if (eventName === "pull_request" || eventName === "pull_request_target") {
    const pull = event.pull_request;
    return { number: pull.number, author: pull.user?.login, sha: pull.head?.sha };
  }
  if (eventName === "issue_comment" && event.issue?.pull_request) {
    const pull = await github(token, `/repos/${repository}/pulls/${event.issue.number}`);
    return {
      number: event.issue.number,
      author: pull.user?.login,
      sha: pull.head?.sha,
      eventComment: event.comment,
    };
  }
  return null;
}

async function loadComments(token, repository, number, eventComment) {
  const payload = await github(token, `/repos/${repository}/issues/${number}/comments?per_page=100`);
  const comments = payload.map((comment) => ({
    id: comment.id,
    login: comment.user?.login,
    body: comment.body,
    createdAt: comment.created_at,
  }));
  if (eventComment && !comments.some((comment) => comment.id === eventComment.id)) {
    comments.push({
      id: eventComment.id,
      login: eventComment.user?.login,
      body: eventComment.body,
      createdAt: eventComment.created_at,
    });
  }
  return comments;
}

async function storeSignature(token, repository, branch, currentSha, doc) {
  const content = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, "utf8").toString("base64");
  await github(token, `/repos/${repository}/contents/signatures/cla.json`, {
    method: "PUT",
    body: {
      message: `Record CLA acceptance for ${doc.signatures.at(-1)?.login ?? "contributor"}\n\nAutomated signature log.`,
      content,
      sha: currentSha,
      branch,
    },
  });
}

export async function runClaGate({ token, repository, eventName, event, branch, serverUrl }) {
  const pull = await loadPullRequest(token, repository, eventName, event);
  if (!pull) {
    console.log("No pull request in this event. CLA gate left idle.");
    return 0;
  }
  if (!pull.sha) throw new Error("Pull request head SHA is missing.");

  const { doc, sha } = await loadSignatures(token, repository, branch);
  if (!doc || doc.claVersion !== CLA_VERSION) {
    throw new Error("signatures/cla.json claVersion does not match the CLA gate.");
  }
  const comments = await loadComments(token, repository, pull.number, pull.eventComment);
  const result = evaluateCla({
    author: pull.author,
    signatures: doc.signatures,
    comments,
    allowlist: allowlistFor(doc),
    claVersion: doc.claVersion,
  });

  if (result.signature) {
    const update = addSignature(doc, result.signature);
    if (update.added) {
      try {
        await storeSignature(token, repository, branch, sha, update.doc);
      } catch (error) {
        console.warn(`CLA comment is valid. The signature file was not updated: ${error.message}`);
      }
    }
  }

  await github(token, `/repos/${repository}/statuses/${pull.sha}`, {
    method: "POST",
    body: {
      state: result.state === "success" ? "success" : "failure",
      context: "Vaulthropic CLA",
      description: statusDescription(result).slice(0, 140),
      target_url: `${serverUrl}/${repository}/blob/${branch}/CLA.md`,
    },
  });

  const reminded = comments.some((comment) => String(comment.body ?? "").includes(REMINDER_MARKER));
  if (result.state === "failure" && !reminded) {
    await github(token, `/repos/${repository}/issues/${pull.number}/comments`, {
      method: "POST",
      body: { body: reminderBody() },
    });
  }

  if (result.state !== "success") {
    console.error(statusDescription(result));
    return 1;
  }
  console.log(statusDescription(result));
  return 0;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !repository || !eventName || !eventPath) {
    throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, and GITHUB_EVENT_PATH are required.");
  }
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const branch = event.repository?.default_branch ?? process.env.GITHUB_REF_NAME;
  if (!branch) throw new Error("Default branch is missing.");
  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const code = await runClaGate({ token, repository, eventName, event, branch, serverUrl });
  process.exit(code);
}

if (runningAsCli()) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
