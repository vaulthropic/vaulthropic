import { REASON_MESSAGES } from "./reasons.js";
import type { SpendDecision } from "./types.js";

export type TighteningOpinion = "block" | "step_up" | "no_opinion";

/**
 * Private commercial rules may only tighten a public decision.
 * An allow can become step-up or block. A step-up can become block.
 * Nothing in this function turns a block or step-up back into an allow.
 */
export function tighten(decision: SpendDecision, opinion: TighteningOpinion): SpendDecision {
  if (opinion === "no_opinion" || decision.outcome === "block") return decision;
  if (decision.outcome === "step_up") {
    if (opinion === "block") {
      return { ...decision, outcome: "block", reason: "BLOCK_TIGHTENED", message: REASON_MESSAGES.BLOCK_TIGHTENED };
    }
    return decision;
  }
  if (opinion === "block") {
    return { ...decision, outcome: "block", reason: "BLOCK_TIGHTENED", message: REASON_MESSAGES.BLOCK_TIGHTENED };
  }
  return { ...decision, outcome: "step_up", reason: "STEP_UP_TIGHTENED", message: REASON_MESSAGES.STEP_UP_TIGHTENED };
}
