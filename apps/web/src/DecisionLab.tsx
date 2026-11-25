import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { examplePolicy } from "@vaulthropic/core";
import type { Environment } from "@vaulthropic/core";
import { minorToUsdc, runLab } from "./lab.js";
import type { LabProtocol, LabResult, LifecycleStep } from "./lab.js";
import { allowlistedRecipient, defaultDraft, draftToInput, findContradictions, fixContradiction } from "./labDraft.js";
import type { Contradiction, LabDraft, LabScenario } from "./labDraft.js";
import { browserDraftStore, clearLabDraft, readLabDraft, saveLabDraft } from "./labDraftStore.js";
import type { DraftRead } from "./labDraftStore.js";

const PROTOCOLS: Array<{ value: LabProtocol; label: string }> = [
  { value: "x402", label: "x402" },
  { value: "ap2", label: "AP2" },
  { value: "mpp", label: "MPP" },
  { value: "mcp", label: "MCP" },
];

export function DecisionLab({
  environment,
  onEnvironment,
  framed = true,
  lockEnvironment = false,
}: {
  environment: Environment;
  onEnvironment?: (environment: Environment) => void;
  framed?: boolean;
  lockEnvironment?: boolean;
}) {
  const [draft, setDraft] = useState<LabDraft>(() => defaultDraft(environment));
  const [result, setResult] = useState<LabResult | null>(null);
  const [stored, setStored] = useState<DraftRead>({ status: "empty" });
  const [draftNotice, setDraftNotice] = useState<string | null>(null);

  useEffect(() => {
    setDraft((current) => (current.environment === environment ? current : { ...current, environment }));
  }, [environment]);

  useEffect(() => {
    setStored(readLabDraft(browserDraftStore()));
  }, []);

  const policy = examplePolicy(draft.environment);
  const alerts = findContradictions(draft);
  const chain = draft.environment === "mainnet" ? "Base Mainnet · eip155:8453" : "Base Sepolia · eip155:84532";

  function update(patch: Partial<LabDraft>) {
    const nextPatch = lockEnvironment ? { ...patch, environment } : patch;
    if (!lockEnvironment && patch.environment && patch.environment !== draft.environment) onEnvironment?.(patch.environment);
    setDraft((current) => ({ ...current, ...nextPatch }));
  }

  function evaluate(next: LabDraft, scenario: LabScenario) {
    const prepared = lockEnvironment ? { ...next, scenario, environment } : { ...next, scenario };
    setDraft(prepared);
    if (!lockEnvironment && prepared.environment !== environment) onEnvironment?.(prepared.environment);
    setResult(runLab(draftToInput(prepared), Math.floor(Date.now() / 1000)));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    evaluate(draft, "decision");
  }

  return (
    <section className={framed ? "panel lab-root" : "lab-plain lab-root"} id={framed ? undefined : "lab"}>
      <h2>Decision lab</h2>
      <p className="note">
        Pre-sign simulation against the example policy. Evaluation does not require an account. Allowlists start from that example. Ceiling edits stay in this page and are not an anchor commitment. Allowlisted recipient <span className="mono">{allowlistedRecipient(draft.environment)}</span>. Asset {policy.assets[0]?.symbol} on {policy.chains[0]}.
      </p>
      <DraftBar
        stored={stored}
        notice={draftNotice}
        onSave={() => {
          const store = browserDraftStore();
          if (!store) {
            setDraftNotice("This browser did not store the draft.");
            return;
          }
          try {
            const saved = saveLabDraft(draft, store);
            setStored({ status: "draft", savedAt: saved.savedAt, draft });
            setDraftNotice(`Draft saved in this browser at ${saved.savedAt}. It is not a committed policy and not an anchor hash.`);
          } catch (caught) {
            setDraftNotice(caught instanceof Error ? caught.message : "This browser did not store the draft.");
          }
        }}
        onLoad={() => {
          if (stored.status !== "draft") return;
          const loaded = lockEnvironment ? { ...stored.draft, environment } : stored.draft;
          const coerced = lockEnvironment && stored.draft.environment !== environment;
          setDraft(loaded);
          setResult(null);
          if (!lockEnvironment && stored.draft.environment !== environment) onEnvironment?.(stored.draft.environment);
          setDraftNotice(coerced
            ? `Loaded the saved draft from ${stored.savedAt}. This tab stays on Base Sepolia. It is not a committed policy.`
            : `Loaded the saved draft from ${stored.savedAt}. It is not a committed policy.`);
        }}
        onClear={() => {
          const store = browserDraftStore();
          if (!store) {
            setDraftNotice("This browser did not clear the draft.");
            return;
          }
          try {
            clearLabDraft(store);
            setStored({ status: "empty" });
            setDraftNotice("Cleared the saved draft in this browser. The form is unchanged.");
          } catch (caught) {
            setDraftNotice(caught instanceof Error ? caught.message : "This browser did not clear the draft.");
          }
        }}
      />
      <form className="lab-steps" onSubmit={onSubmit}>
        <fieldset className="lab-step">
          <legend><span className="step-index">1</span> {lockEnvironment ? "Select protocol and counterparty" : "Select network, protocol, and counterparty"}</legend>
          <p className="note">
            Each evaluation starts again from the example policy for {chain}. The page keeps no AttemptLedger and no nonce cursor past that result. x402, AP2, MPP, and MCP share the same budget, fee-ceiling, and idempotency checks inside the evaluation. A host that settles would hold its session signer in a serial queue until the open attempt settles or releases.
          </p>
          <div className="form lab-form">
            {lockEnvironment ? null : (
              <label htmlFor="lab-network">Network
                <select id="lab-network" value={draft.environment} onChange={(event) => update({ environment: event.target.value as Environment })}>
                  <option value="sandbox">Base Sepolia · eip155:84532</option>
                  <option value="mainnet">Base Mainnet · eip155:8453</option>
                </select>
              </label>
            )}
            <label htmlFor="lab-protocol">Protocol
              <select id="lab-protocol" value={draft.protocol} onChange={(event) => update({ protocol: event.target.value as LabProtocol })}>
                {PROTOCOLS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="span-2" htmlFor="lab-recipient">Recipient address
              <input id="lab-recipient" className="mono" value={draft.recipient} spellCheck={false} onChange={(event) => update({ recipient: event.target.value })} />
            </label>
            <label className="span-2" htmlFor="lab-endpoint">Endpoint URL
              <input id="lab-endpoint" value={draft.endpoint} spellCheck={false} onChange={(event) => update({ endpoint: event.target.value })} />
            </label>
            <div className="span-2">
              <button className="btn quiet" type="button" onClick={() => update({ recipient: allowlistedRecipient(draft.environment), endpoint: `${examplePolicy(draft.environment).allowlists.endpoints[0]}/quote` })}>
                Use example allowlisted recipient
              </button>
            </div>
          </div>
        </fieldset>

        <fieldset className="lab-step">
          <legend><span className="step-index">2</span> Configure session ceilings and fee/gas guardrails</legend>
          <p className="note">Principal, quoted fee, and gas all count against the epoch budget. An empty fee or gas ceiling refuses a positive quote.</p>
          <div className="form lab-form">
            <AmountField id="lab-epoch" label="Epoch budget (USDC)" value={draft.epochBudget} onChange={(epochBudget) => update({ epochBudget })} />
            <AmountField id="lab-per-tx" label="Max per-transaction cap (USDC)" value={draft.maxPerTx} onChange={(maxPerTx) => update({ maxPerTx })} />
            <AmountField id="lab-step-up" label="Step-up approval threshold (USDC)" value={draft.stepUp} onChange={(stepUp) => update({ stepUp })} />
            <label htmlFor="lab-ttl">Session TTL (seconds)
              <input id="lab-ttl" inputMode="numeric" value={draft.ttlSeconds} onChange={(event) => update({ ttlSeconds: event.target.value })} />
            </label>
            <AmountField id="lab-fee-amount" label="Max fee amount (USDC)" value={draft.maxFeeAmount} onChange={(maxFeeAmount) => update({ maxFeeAmount })} placeholder="Not set" />
            <label htmlFor="lab-fee-bps">Max fee (basis points)
              <input id="lab-fee-bps" inputMode="numeric" placeholder="Not set" value={draft.maxFeeBps} onChange={(event) => update({ maxFeeBps: event.target.value })} />
            </label>
            <AmountField id="lab-gas" label="Max gas ceiling (USDC)" value={draft.maxGasAmount} onChange={(maxGasAmount) => update({ maxGasAmount })} placeholder="Not set" />
            <AmountField id="lab-combined" label="Combined ceiling (USDC)" value={draft.maxCombinedAmount} onChange={(maxCombinedAmount) => update({ maxCombinedAmount })} placeholder="Not set" />
          </div>
          <ContradictionList alerts={alerts} onFix={(kind) => update(fixContradiction(draft, kind))} />
        </fieldset>

        <fieldset className="lab-step">
          <legend><span className="step-index">3</span> Simulate payment intent and inspect the pre-sign verdict</legend>
          <div className="form lab-form">
            <AmountField id="lab-amount" label="Test amount (USDC)" value={draft.amount} onChange={(amount) => update({ amount })} />
            <AmountField id="lab-quoted-fee" label="Quoted fee (USDC)" value={draft.quotedFee} onChange={(quotedFee) => update({ quotedFee })} />
            <AmountField id="lab-estimated-gas" label="Estimated gas (USDC)" value={draft.estimatedGas} onChange={(estimatedGas) => update({ estimatedGas })} />
          </div>
          <div className="lab-actions">
            <button className="btn quiet" type="button" onClick={() => evaluate({ ...draft, amount: "1", quotedFee: "0", estimatedGas: "0" }, "decision")}>1 USDC · Direct Allow</button>
            <button className="btn quiet" type="button" onClick={() => evaluate({ ...draft, amount: "10", quotedFee: "0", estimatedGas: "0" }, "decision")}>10 USDC · Step-Up</button>
            <button className="btn quiet" type="button" onClick={() => evaluate({ ...draft, amount: "30", quotedFee: "0", estimatedGas: "0" }, "decision")}>30 USDC · Over-Cap Block</button>
            <button className="btn quiet" type="button" onClick={() => evaluate({ ...draft, amount: "1", quotedFee: "0", estimatedGas: "0" }, "replay")}>Replay / In-Flight Test</button>
          </div>
          <div className="lab-actions">
            <button className="btn primary-solid" id="lab-evaluate" type="submit">Evaluate Before Signing</button>
          </div>
          <p className="note">Evaluate Before Signing does not sign a payload or broadcast a transaction. Base Sepolia is the sandbox. A Base mainnet selection stays a local pre-sign check. The lifecycle under the verdict is a preview, or an in-page simulation with a synthetic hash. It is not a receipt.</p>
          <LabVerdict result={result} />
        </fieldset>
      </form>
    </section>
  );
}

function DraftBar({
  stored,
  notice,
  onSave,
  onLoad,
  onClear,
}: {
  stored: DraftRead;
  notice: string | null;
  onSave: () => void;
  onLoad: () => void;
  onClear: () => void;
}) {
  const saved = stored.status === "draft";
  return (
    <div id="lab-draft">
      <p className="note">Nothing is stored until you click Save draft in this browser. A saved draft is not a committed policy.</p>
      <div className="lab-actions">
        <button className="btn quiet" type="button" onClick={onSave}>Save draft in this browser</button>
        <button className="btn quiet" type="button" disabled={!saved} onClick={onLoad}>Load saved draft</button>
        <button className="btn quiet" type="button" disabled={stored.status === "empty"} onClick={onClear}>Clear saved draft</button>
      </div>
      {saved ? <p className="note">Saved draft in this browser at <span className="mono">{stored.savedAt}</span>. It is not a committed policy.</p> : null}
      {stored.status === "unreadable" ? <p className="alert" role="alert">The saved draft could not be read. Clear it before saving again.</p> : null}
      {notice ? <p className="note" role="status">{notice}</p> : null}
    </div>
  );
}

function AmountField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label htmlFor={id}>{label}
      <input id={id} inputMode="decimal" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ContradictionList({ alerts, onFix }: { alerts: Contradiction[]; onFix: (kind: Contradiction["kind"]) => void }) {
  if (alerts.length === 0) return null;
  return (
    <div id="lab-contradictions">
      {alerts.map((alert) => (
        <div className={alert.severity === "contradiction" ? "contradiction" : "contradiction is-warning"} key={alert.kind} role="alert">
          <p>{alert.message}</p>
          <button className="btn quiet" type="button" onClick={() => onFix(alert.kind)}>Fix automatically</button>
        </div>
      ))}
    </div>
  );
}

function LabVerdict({ result }: { result: LabResult | null }) {
  if (!result) return null;
  if ("error" in result) return <p className="alert" role="alert">{result.error}</p>;
  const { decision } = result;
  const label = decision.outcome === "allow" ? "ALLOW" : decision.outcome === "step_up" ? "STEP-UP REQUIRED" : "BLOCKED";
  return (
    <div className="verdict-panel" id="lab-verdict">
      <p className={`verdict verdict-${decision.outcome}`} role="status">
        <span className="verdict-label">{label}</span>
        <span className="mono">{decision.reason}</span>
      </p>
      <p className="note">{decision.message}</p>
      <p className="mono math-line">
        {usdc(result.math.principalMinor)} + {usdc(result.math.feeMinor)} + {usdc(result.math.gasMinor)} = {usdc(result.math.totalMinor)}
      </p>
      <p className="note">Epoch budget {usdc(result.math.epochMinor)}. Remaining epoch budget {usdc(result.math.remainingMinor)}. {result.mathNote}</p>
      {result.companion ? <p className="note">While the first simulated attempt was open, a second serial begin returned <span className="mono">{result.companion.reason}</span>. {result.companion.message}</p> : null}
      {result.labNotices.map((notice) => <p className="note" key={notice}>{notice}</p>)}
      <h3>{result.mode === "ledger" ? "Simulated AttemptLedger" : "AttemptLedger preview"}</h3>
      <ol className="lifecycle">
        {result.lifecycle.map((step, index) => <LifecycleItem key={step.id} index={index + 1} step={step} />)}
      </ol>
    </div>
  );
}

function LifecycleItem({ index, step }: { index: number; step: LifecycleStep }) {
  return (
    <li className={`life life-${step.mark}`}>
      <span className="step-index">{index}</span>
      <span>
        <strong>{step.label}</strong> <span className="mono">{step.status}</span>
        <span className="note life-detail">{step.detail}</span>
      </span>
    </li>
  );
}

/** Session-only mainnet endpoint and payTo. This component does not read or write the rehearsal draft. */
export function MainnetGate({
  endpoint,
  payTo,
  onEndpoint,
  onPayTo,
}: {
  endpoint: string;
  payTo: string;
  onEndpoint: (value: string) => void;
  onPayTo: (value: string) => void;
}) {
  return (
    <section className="panel lab-root">
      <h2>Mainnet</h2>
      <p className="note">
        Base (<span className="mono">eip155:8453</span>) is the v1 mainnet selector. <span className="mono">contracts/deployments/base.json</span> is not-deployed. <span className="mono">policyAnchor</span> and <span className="mono">guardAccountFactory</span> are null. Enter a live endpoint URL and the public payTo address when those values are ready. This form keeps them in this tab only. It does not write the testnet rehearsal draft, and it has no field for a private key, seed phrase, or API token. Nothing here is signed or broadcast.
      </p>
      <form className="form" autoComplete="off" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="mainnet-endpoint">Live endpoint URL
          <input id="mainnet-endpoint" value={endpoint} spellCheck={false} autoComplete="off" placeholder="https://" onChange={(event) => onEndpoint(event.target.value)} />
        </label>
        <label htmlFor="mainnet-payto">Public payTo address
          <input id="mainnet-payto" className="mono" value={payTo} spellCheck={false} autoComplete="off" onChange={(event) => onPayTo(event.target.value)} />
        </label>
        <button className="btn primary-solid" type="button" disabled>Live settlement is not deployed.</button>
      </form>
    </section>
  );
}

function usdc(minor: string): string {
  if (!/^\d+$/.test(minor)) return minor;
  return `${minorToUsdc(BigInt(minor))} USDC`;
}
