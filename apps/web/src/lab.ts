import { PresenceVerifier, cartCommitment, evaluateAp2 } from "@vaulthropic/ap2";
import { AttemptLedger, anchorDraft, examplePolicy } from "@vaulthropic/core";
import type { AttemptRecord, Environment, ReasonCode, SpendDecision, SpendPolicy } from "@vaulthropic/core";
import { gateMcpToolCall } from "@vaulthropic/mcp-gate";
import { evaluateMpp, parseChallenge } from "@vaulthropic/mpp";
import { evaluateX402 } from "@vaulthropic/x402";

export type LabProtocol = "x402" | "ap2" | "mpp" | "mcp";

export type LabCeilings = {
  maxPerTxUsdc?: string;
  epochBudgetUsdc?: string;
  stepUpUsdc?: string;
  ttlSeconds?: number;
  maxFeeAmountUsdc?: string;
  maxFeeBps?: number;
  maxGasAmountUsdc?: string;
  maxCombinedAmountUsdc?: string;
};

export type LabInput = {
  protocol: LabProtocol;
  environment: Environment;
  amountUsdc: string;
  recipient: string;
  endpoint: string;
  ceilings?: LabCeilings;
  quotedFeeUsdc?: string;
  estimatedGasUsdc?: string;
  scenario?: "decision" | "replay";
};

export type LabMath = {
  principalMinor: string;
  feeMinor: string;
  gasMinor: string;
  totalMinor: string;
  epochMinor: string;
  remainingMinor: string;
};

export type LifecycleMark = "done" | "next" | "open" | "release" | "skipped";

export type LifecycleStep = {
  id: string;
  label: string;
  status: string;
  detail: string;
  mark: LifecycleMark;
};

export type LabSuccess = {
  decision: SpendDecision;
  policy: SpendPolicy;
  math: LabMath;
  mathNote: string;
  lifecycle: LifecycleStep[];
  mode: "preview" | "ledger";
  protocol: LabProtocol;
  /** What this page actually checked. These lines are part of the verdict, not a spend reason. */
  labNotices: string[];
  companion?: { reason: ReasonCode; message: string };
};

export type LabResult = LabSuccess | { error: string; policy: SpendPolicy };

const SIGNATURE = "console-demo-signature";
const TX = `0x${"ab".repeat(32)}` as const;
const MAX_TTL_SECONDS = 366 * 24 * 60 * 60;

export function parseUsdcMinor(value: string, allowZero = false): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(6, "0");
  const minor = BigInt(whole) * 1_000_000n + BigInt(fraction || "0");
  if (!allowZero && minor === 0n) return null;
  return minor;
}

export function usdcToMinor(value: string, options?: { allowZero?: boolean }): string {
  const allowZero = options?.allowZero ?? false;
  const minor = parseUsdcMinor(value, allowZero);
  if (minor !== null) return minor.toString();
  if (parseUsdcMinor(value, true) === 0n) throw new Error("Amount must be greater than zero.");
  throw new Error("Enter a USDC amount with up to 6 decimal places.");
}

export function minorToUsdc(minor: bigint): string {
  const whole = minor / 1_000_000n;
  const fraction = (minor % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

export function runLab(input: LabInput, now: number): LabResult {
  let policy = examplePolicy(input.environment);
  try {
    policy = policyForInput(input, now);
    const amount = usdcToMinor(input.amountUsdc);
    const fee = optionalQuote(input.quotedFeeUsdc);
    const gas = optionalQuote(input.estimatedGasUsdc);
    const math = buildMath(policy, amount, fee ?? "0", gas ?? "0", 0n);
    if (input.scenario === "replay") return runReplay(policy, input, now, amount, fee, gas, math);
    const decision = asDecision(evaluateProtocol(policy, input, now, amount, fee, gas));
    return labSuccess({
      decision,
      policy,
      math,
      mathNote: mathNote(decision, math, false),
      lifecycle: previewLifecycle(decision, math),
      mode: "preview",
      protocol: input.protocol,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The lab could not evaluate that request.", policy };
  }
}

export function anchorPreview(environment: Environment) {
  return anchorDraft(examplePolicy(environment));
}

function policyForInput(input: LabInput, now: number): SpendPolicy {
  const base = examplePolicy(input.environment);
  const ceilings = input.ceilings;
  if (!ceilings) return base;
  const limits: SpendPolicy["limits"] = { ...base.limits };
  if (ceilings.maxPerTxUsdc !== undefined) limits.perTransaction = usdcToMinor(ceilings.maxPerTxUsdc);
  if (ceilings.epochBudgetUsdc !== undefined) limits.perEpoch = usdcToMinor(ceilings.epochBudgetUsdc);
  if (ceilings.stepUpUsdc !== undefined) limits.stepUpAbove = usdcToMinor(ceilings.stepUpUsdc);
  if (ceilings.maxFeeAmountUsdc !== undefined) limits.maxFeeAmount = usdcToMinor(ceilings.maxFeeAmountUsdc, { allowZero: true });
  if (ceilings.maxFeeBps !== undefined) limits.maxFeeBps = ceilings.maxFeeBps;
  if (ceilings.maxGasAmountUsdc !== undefined) limits.maxGasAmount = usdcToMinor(ceilings.maxGasAmountUsdc, { allowZero: true });
  if (ceilings.maxCombinedAmountUsdc !== undefined) limits.maxCombinedAmount = usdcToMinor(ceilings.maxCombinedAmountUsdc);
  let session = base.session;
  if (ceilings.ttlSeconds !== undefined) {
    if (!Number.isInteger(ceilings.ttlSeconds) || ceilings.ttlSeconds < 0 || ceilings.ttlSeconds > MAX_TTL_SECONDS) {
      throw new Error("Session TTL must be a whole number of seconds from 0 through 366 days.");
    }
    session = { ...session, validUntil: ceilings.ttlSeconds === 0 ? now : now + ceilings.ttlSeconds };
  }
  return { ...base, limits, session };
}

function optionalQuote(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const minor = usdcToMinor(value, { allowZero: true });
  return minor === "0" ? undefined : minor;
}

function evaluateProtocol(policy: SpendPolicy, input: LabInput, now: number, amount: string, fee: string | undefined, gas: string | undefined): SpendDecision {
  const usage = { spent: "0", windowStartedAt: now - 60 };
  const chain = policy.chains[0] ?? "";
  const quote = {
    ...(fee === undefined ? {} : { quotedFeeAmount: fee }),
    ...(gas === undefined ? {} : { maxGasFee: gas }),
  };
  if (input.protocol === "x402") {
    return evaluateX402({
      policy,
      usage,
      now,
      ...quote,
      required: {
        x402Version: 2,
        resource: { url: input.endpoint },
        accepts: [
          {
            scheme: "exact",
            network: chain,
            amount,
            asset: policy.assets[0]?.asset ?? "",
            payTo: input.recipient,
            maxTimeoutSeconds: 60,
            extra: { name: "USDC", version: "2" },
          },
        ],
      },
    });
  }
  if (input.protocol === "ap2") {
    const base = {
      payer: policy.account,
      payee: input.recipient,
      amount: { value: amount, currency: "USDC" },
      issuedAt: now - 60,
      expiresAt: now + 600,
      nonce: "console-nonce",
      signature: SIGNATURE,
    };
    const cart = { ...base, mandateType: "cart" as const, id: "cart-console" };
    return evaluateAp2({
      policy,
      usage,
      chain,
      now,
      endpoint: input.endpoint,
      signatures: new PresenceVerifier(),
      ...quote,
      intent: { ...base, mandateType: "intent", id: "intent-console", amount: { value: "100000000", currency: "USDC" } },
      cart,
      payment: { ...base, mandateType: "payment", id: "payment-console", cartHash: cartCommitment(cart) },
    });
  }
  if (input.protocol === "mpp") {
    const request = btoa(JSON.stringify({ amount, currency: "USDC", recipient: input.recipient, chain }));
    const challenge = parseChallenge(`WWW-Authenticate: Payment id="console", method="exact", intent="charge", request="${request}"`);
    return evaluateMpp({ policy, usage, challenge, chain, now, endpoint: input.endpoint, ...quote });
  }
  return gateMcpToolCall({
    policy,
    usage,
    now,
    chain,
    call: {
      server: "https://mcp.example.com",
      tool: "quote",
      arguments: {
        amount,
        payTo: input.recipient,
        asset: "USDC",
        url: input.endpoint,
        ...(fee === undefined ? {} : { quotedFeeAmount: fee }),
        ...(gas === undefined ? {} : { maxGasFee: gas }),
      },
    },
  });
}

function runReplay(
  policy: SpendPolicy,
  input: LabInput,
  now: number,
  amount: string,
  fee: string | undefined,
  gas: string | undefined,
  math: LabMath,
): LabSuccess {
  const usage = { spent: "0", windowStartedAt: now - 60 };
  const inflight = new AttemptLedger();
  inflight.setSignerNonce(policy.session.signer, "0");
  const opened = inflight.begin({ policy, intent: intentFor(policy, input, now, amount, fee, gas, "lab-intent-open", "lab-challenge-open"), chainUsage: usage });
  let companion: LabSuccess["companion"];
  if (opened.decision.outcome === "allow") {
    const queued = inflight.begin({
      policy,
      intent: intentFor(policy, input, now, amount, fee, gas, "lab-intent-queued", "lab-challenge-queued"),
      chainUsage: usage,
    });
    companion = { reason: queued.decision.reason, message: queued.decision.message };
  }

  const ledger = new AttemptLedger();
  ledger.setSignerNonce(policy.session.signer, "0");
  const started = ledger.begin({
    policy,
    intent: intentFor(policy, input, now, amount, fee, gas, "lab-intent-1", "lab-challenge"),
    chainUsage: usage,
  });
  if (started.decision.outcome !== "allow" || !started.record) {
    const decision = asDecision(started.decision);
    return labSuccess({
      decision,
      policy,
      math,
      mathNote: mathNote(decision, math, false),
      lifecycle: previewLifecycle(decision, math),
      mode: "preview",
      protocol: input.protocol,
      ...(companion ? { companion } : {}),
    });
  }

  const key = started.record.idempotencyKey;
  observeOrThrow(ledger, key, { status: "IN_FLIGHT_PENDING", now: now + 1, txHash: TX });
  observeOrThrow(ledger, key, { status: "INCLUDED_UNFINALIZED", now: now + 2, txHash: TX });
  const finalized = observeOrThrow(ledger, key, { status: "FINALIZED", now: now + 3, txHash: TX, receiptId: "lab-receipt" });
  const settled = BigInt(finalized.settledAmount || finalized.reservedAmount);
  const epoch = BigInt(policy.limits.perEpoch);
  const remaining = epoch > settled ? epoch - settled : 0n;
  const settledMath = { ...math, remainingMinor: remaining.toString() };
  const replay = ledger.begin({
    policy,
    intent: intentFor(policy, input, now + 4, amount, fee, gas, "lab-intent-replay", "lab-challenge"),
    chainUsage: usage,
  });
  const decision = asDecision(replay.decision);
  return labSuccess({
    decision,
    policy,
    math: settledMath,
    mathNote: `In this page, a simulated attempt finalized and committed ${minorToUsdc(settled)} USDC of the example epoch. Remaining budget in that discarded ledger is ${minorToUsdc(remaining)} USDC. The replay reserved nothing. The transaction hash is synthetic.`,
    lifecycle: settledLifecycle(finalized, companion?.reason),
    mode: "ledger",
    protocol: input.protocol,
    ...(companion ? { companion } : {}),
  });
}

function labSuccess(result: Omit<LabSuccess, "labNotices">): LabSuccess {
  return { ...result, labNotices: labNotices(result.protocol, result.mode) };
}

function labNotices(protocol: LabProtocol, mode: LabSuccess["mode"]): string[] {
  const notices = [
    mode === "ledger"
      ? "Simulated AttemptLedger in this page. The transaction hash is synthetic. Nothing was broadcast, and this ledger is discarded with the result."
      : "AttemptLedger preview. This evaluation did not open a ledger or reserve a budget.",
  ];
  if (protocol === "ap2") {
    notices.push(
      "Presence check only. This is not SD-JWT verification. The lab intent fixture is 100 USDC, so payment plus fee plus gas above that returns BLOCK_MANDATE_AMOUNT before the session cap.",
    );
  }
  return notices;
}

function intentFor(
  policy: SpendPolicy,
  input: LabInput,
  now: number,
  amount: string,
  fee: string | undefined,
  gas: string | undefined,
  requestIntentId: string,
  challengeId: string,
) {
  const deadline = Math.min(now + 120, policy.session.validUntil);
  return {
    agentId: "lab-agent",
    sessionId: "lab-session",
    requestIntentId,
    protocol: input.protocol,
    environment: input.environment,
    chain: policy.chains[0] ?? "",
    asset: policy.assets[0]?.asset ?? "",
    recipient: input.recipient,
    amount,
    endpoint: input.endpoint,
    now,
    deadline,
    signer: policy.session.signer,
    finality: "irreversible" as const,
    challengeId,
    ...(fee === undefined ? {} : { quotedFeeAmount: fee }),
    ...(gas === undefined ? {} : { maxGasFee: gas }),
  };
}

function observeOrThrow(ledger: AttemptLedger, key: string, observation: Parameters<AttemptLedger["observe"]>[1]): AttemptRecord {
  const result = ledger.observe(key, observation);
  if (!result.accepted || !result.record) throw new Error(result.message);
  return result.record;
}

function asDecision(decision: SpendDecision): SpendDecision {
  return {
    outcome: decision.outcome,
    reason: decision.reason,
    message: decision.message,
    policyHash: decision.policyHash,
  };
}

function buildMath(policy: SpendPolicy, principal: string, fee: string, gas: string, alreadySettled: bigint): LabMath {
  const principalMinor = BigInt(principal);
  const feeMinor = BigInt(fee);
  const gasMinor = BigInt(gas);
  const total = principalMinor + feeMinor + gasMinor;
  const epoch = /^\d+$/.test(policy.limits.perEpoch) ? BigInt(policy.limits.perEpoch) : 0n;
  const remaining = epoch > alreadySettled ? epoch - alreadySettled : 0n;
  return {
    principalMinor: principalMinor.toString(),
    feeMinor: feeMinor.toString(),
    gasMinor: gasMinor.toString(),
    totalMinor: total.toString(),
    epochMinor: epoch.toString(),
    remainingMinor: remaining.toString(),
  };
}

function mathNote(decision: SpendDecision, math: LabMath, reserved: boolean): string {
  const total = minorToUsdc(BigInt(math.totalMinor));
  const remaining = minorToUsdc(BigInt(math.remainingMinor));
  if (decision.outcome === "allow" && !reserved) {
    return `This preview did not reserve. The attempt would reserve ${total} USDC against ${remaining} USDC still in the epoch.`;
  }
  if (decision.outcome === "step_up") {
    return `Step-up does not reserve. Principal + fee + gas is ${total} USDC. Remaining epoch budget is ${remaining} USDC.`;
  }
  return `No reservation was taken. Principal + fee + gas is ${total} USDC. Remaining epoch budget is ${remaining} USDC.`;
}

function previewLifecycle(decision: SpendDecision, math: LabMath): LifecycleStep[] {
  const reserved = decision.outcome === "allow";
  const total = minorToUsdc(BigInt(math.totalMinor));
  const early = reserved
    ? "An allow would open this step. This preview did not write an attempt."
    : "Not reached. A block or step-up returns before AttemptLedger opens a record.";
  return [
    { id: "created", label: "Open the attempt", status: "CREATED", mark: reserved ? "next" : "skipped", detail: early },
    {
      id: "reserved",
      label: "Reserve budget",
      status: "held on CREATED",
      mark: reserved ? "next" : "skipped",
      detail: `The reservation is principal + fee + gas (${total} USDC).`,
    },
    {
      id: "nonce",
      label: "Assign nonce",
      status: "nonce on CREATED",
      mark: reserved ? "next" : "skipped",
      detail: "An eip155 signer needs a seeded cursor. The ledger assigns the next nonce in the same call. An unset cursor is BLOCK_NONCE_UNAVAILABLE.",
    },
    {
      id: "inflight",
      label: "Broadcast",
      status: "IN_FLIGHT_PENDING",
      mark: "open",
      detail: "The host records IN_FLIGHT_PENDING with the transaction hash. A second serial begin while this is open is BLOCK_ATTEMPT_IN_FLIGHT.",
    },
    {
      id: "included",
      label: "Inclusion",
      status: "INCLUDED_UNFINALIZED",
      mark: "open",
      detail: "Fast finality commits the budget here. Irreversible finality keeps the reservation until FINALIZED.",
    },
    {
      id: "finalized",
      label: "Finality",
      status: "FINALIZED",
      mark: "open",
      detail: "FINALIZED is terminal. A later intent that presents the settled challenge or mandate is BLOCK_REPLAY.",
    },
    {
      id: "released",
      label: "Release on failure",
      status: "DROPPED · REVERTED · EXPIRED_OR_DROPPED · FAILED",
      mark: "release",
      detail: "A drop, revert, failure, or expiry releases the reservation. Deadline or Solana blockhash expiry becomes EXPIRED_OR_DROPPED with BLOCK_DEADLINE_EXCEEDED.",
    },
  ];
}

function settledLifecycle(record: AttemptRecord, companionReason: ReasonCode | undefined): LifecycleStep[] {
  const queued = companionReason === "BLOCK_ATTEMPT_IN_FLIGHT"
    ? " A second serial begin while this attempt was open returned BLOCK_ATTEMPT_IN_FLIGHT."
    : "";
  return [
    { id: "created", label: "Open the attempt", status: "CREATED", mark: "done", detail: "A new AttemptLedger in this page opened the attempt. That ledger is discarded with this result." },
    {
      id: "reserved",
      label: "Reserve budget",
      status: "held on CREATED",
      mark: "done",
      detail: `Reserved ${minorToUsdc(BigInt(record.reservedAmount))} USDC in that page ledger, then the simulation marked it FINALIZED.`,
    },
    {
      id: "nonce",
      label: "Assign nonce",
      status: "nonce on CREATED",
      mark: "done",
      detail: `Assigned nonce ${record.nonce ?? "none"}. The simulation seeded the cursor at 0. An unset cursor is BLOCK_NONCE_UNAVAILABLE.`,
    },
    {
      id: "inflight",
      label: "Broadcast",
      status: "IN_FLIGHT_PENDING",
      mark: "done",
      detail: `Recorded IN_FLIGHT_PENDING with a synthetic transaction hash. Nothing was broadcast.${queued}`,
    },
    {
      id: "included",
      label: "Inclusion",
      status: "INCLUDED_UNFINALIZED",
      mark: "done",
      detail: "Recorded inclusion in the page ledger. This attempt used irreversible finality, so the simulated budget stayed reserved until FINALIZED.",
    },
    {
      id: "finalized",
      label: "Finality",
      status: "FINALIZED",
      mark: "done",
      detail: "The simulation marked FINALIZED and consumed the challenge. The next begin with that challenge is the verdict above. This is not a chain receipt.",
    },
    {
      id: "released",
      label: "Release on failure",
      status: "DROPPED · REVERTED · EXPIRED_OR_DROPPED · FAILED",
      mark: "skipped",
      detail: "Not taken. The simulation finalized, so the reservation was committed in the page ledger rather than released.",
    },
  ];
}
