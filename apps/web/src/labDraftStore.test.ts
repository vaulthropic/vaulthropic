import { describe, expect, it } from "vitest";
import { defaultDraft } from "./labDraft.js";
import { clearLabDraft, readLabDraft, saveLabDraft } from "./labDraftStore.js";
import type { DraftStore } from "./labDraftStore.js";

function memoryStore(): DraftStore & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => raw.set(key, value),
    removeItem: (key) => raw.delete(key),
  };
}

describe("decision lab draft store", () => {
  it("stores a draft only through save and labels it as a draft", () => {
    const store = memoryStore();
    expect(readLabDraft(store)).toEqual({ status: "empty" });
    const draft = { ...defaultDraft("sandbox"), amount: "4" };
    const saved = saveLabDraft(draft, store, new Date("2026-01-01T00:00:00Z"));
    expect(saved.savedAt).toBe("2026-01-01T00:00:00.000Z");
    const stored = [...store.raw.values()][0] ?? "";
    expect(stored).toContain("\"kind\":\"draft\"");
    expect(stored).not.toContain("policyHash");
    expect(readLabDraft(store)).toEqual({ status: "draft", savedAt: saved.savedAt, draft });
    clearLabDraft(store);
    expect(readLabDraft(store)).toEqual({ status: "empty" });
  });

  it("refuses a record that claims to be a commitment", () => {
    const store = memoryStore();
    store.setItem("vaulthropic.decision-lab-draft", JSON.stringify({
      kind: "commitment",
      savedAt: "2026-01-01T00:00:00Z",
      policyHash: "0xabc",
      draft: defaultDraft("sandbox"),
    }));
    expect(readLabDraft(store).status).toBe("unreadable");
    store.setItem("vaulthropic.decision-lab-draft", "{");
    expect(readLabDraft(store).status).toBe("unreadable");
  });
});
