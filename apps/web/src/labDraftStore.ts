import type { LabDraft } from "./labDraft.js";

/** Browser draft only. This record is not a policy commitment and has no anchor hash. */
const DRAFT_KEY = "vaulthropic.decision-lab-draft";
const MAX_FIELD = 500;

const PROTOCOLS = new Set(["x402", "ap2", "mpp", "mcp"]);
const TEXT_FIELDS = [
  "recipient",
  "endpoint",
  "epochBudget",
  "maxPerTx",
  "stepUp",
  "ttlSeconds",
  "maxFeeAmount",
  "maxFeeBps",
  "maxGasAmount",
  "maxCombinedAmount",
  "amount",
  "quotedFee",
  "estimatedGas",
] as const;

export type DraftStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type StoredLabDraft = {
  status: "draft";
  savedAt: string;
  draft: LabDraft;
};

export type DraftRead = { status: "empty" } | StoredLabDraft | { status: "unreadable" };

export function readLabDraft(store: DraftStore | null): DraftRead {
  if (!store) return { status: "unreadable" };
  let raw: string | null;
  try {
    raw = store.getItem(DRAFT_KEY);
  } catch {
    return { status: "unreadable" };
  }
  if (raw === null) return { status: "empty" };
  return parseStoredDraft(raw);
}

export function saveLabDraft(draft: LabDraft, store: DraftStore, now = new Date()): { savedAt: string } {
  const copy = copyDraft(draft);
  if (!copy) throw new Error("This draft cannot be stored.");
  const savedAt = now.toISOString();
  const record = { kind: "draft", savedAt, draft: copy };
  try {
    store.setItem(DRAFT_KEY, JSON.stringify(record));
  } catch {
    throw new Error("This browser did not store the draft.");
  }
  return { savedAt };
}

export function clearLabDraft(store: DraftStore): void {
  try {
    store.removeItem(DRAFT_KEY);
  } catch {
    throw new Error("This browser did not clear the draft.");
  }
}

export function browserDraftStore(): DraftStore | null {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    return store;
  } catch {
    return null;
  }
}

function parseStoredDraft(raw: string): DraftRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "unreadable" };
  }
  if (!parsed || typeof parsed !== "object") return { status: "unreadable" };
  const record = parsed as Record<string, unknown>;
  if (record.kind !== "draft" || "policyHash" in record) return { status: "unreadable" };
  if (typeof record.savedAt !== "string" || !isIsoTime(record.savedAt)) return { status: "unreadable" };
  if (!record.draft || typeof record.draft !== "object" || "policyHash" in record.draft) return { status: "unreadable" };
  const draft = copyDraft(record.draft);
  if (!draft) return { status: "unreadable" };
  return { status: "draft", savedAt: record.savedAt, draft };
}

function copyDraft(input: unknown): LabDraft | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (record.environment !== "sandbox" && record.environment !== "mainnet") return null;
  if (typeof record.protocol !== "string" || !PROTOCOLS.has(record.protocol)) return null;
  if (record.scenario !== "decision" && record.scenario !== "replay") return null;
  const draft: LabDraft = {
    environment: record.environment,
    protocol: record.protocol as LabDraft["protocol"],
    scenario: record.scenario,
    recipient: "",
    endpoint: "",
    epochBudget: "",
    maxPerTx: "",
    stepUp: "",
    ttlSeconds: "",
    maxFeeAmount: "",
    maxFeeBps: "",
    maxGasAmount: "",
    maxCombinedAmount: "",
    amount: "",
    quotedFee: "",
    estimatedGas: "",
  };
  for (const field of TEXT_FIELDS) {
    const value = record[field];
    if (typeof value !== "string" || value.length > MAX_FIELD) return null;
    draft[field] = value;
  }
  return draft;
}

function isIsoTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}
