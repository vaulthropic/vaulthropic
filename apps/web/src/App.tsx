import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  base32Encode,
  examplePolicy,
  generateTotpSecret,
  issueApiKey,
  verifyTotp,
} from "@vaulthropic/core";
import type { ApiKeyRecord, Environment } from "@vaulthropic/core";
import { consoleUserName, discoverWallets, platformPasskeyAvailable, prepareWalletSignIn, registerPasskey, signInWithPasskey, signPreparedWallet, walletIconSrc } from "./browserAuth.js";
import type { ConsoleIdentity, WalletChoice } from "./browserAuth.js";
import { DecisionLab, MainnetGate } from "./DecisionLab.js";
import { DocsPage } from "./DocsPage.js";
import { anchorPreview } from "./lab.js";

type View = "home" | "signin" | "console" | "docs" | "lab";

const FOOTER_RAILS: Array<[string, string]> = [
  ["x402", "x402"],
  ["AP2", "ap2"],
  ["MPP", "mpp"],
  ["MCP", "mcp"],
];

const ENVIRONMENTS: Array<{ value: Environment; label: string; caip2: string }> = [
  { value: "sandbox", label: "Base Sepolia", caip2: "eip155:84532" },
  { value: "mainnet", label: "Base", caip2: "eip155:8453" },
];

function environmentLabel(environment: Environment): string {
  const match = ENVIRONMENTS.find((item) => item.value === environment) ?? ENVIRONMENTS[0];
  return `${match.label} · ${match.caip2}`;
}

function routeFromLocation(): View {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/docs" || path.startsWith("/docs/")) return "docs";
  if (path === "/sign-in") return "signin";
  if (path === "/console") return "console";
  if (path === "/lab" || (path === "/" && window.location.hash === "#lab")) return "lab";
  return "home";
}

function pathFor(next: View): string {
  if (next === "docs") return "/docs";
  if (next === "signin") return "/sign-in";
  if (next === "console") return "/console";
  if (next === "lab") return "/lab";
  return "/";
}

function rewriteLabAlias() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/" && window.location.hash === "#lab") {
    window.history.replaceState({ view: "lab" }, "", "/lab");
  }
}

export function App() {
  const [view, setView] = useState<View>(() => routeFromLocation());
  const [identity, setIdentity] = useState<ConsoleIdentity | null>(null);
  const [environment, setEnvironment] = useState<Environment>("sandbox");
  const [menuOpen, setMenuOpen] = useState(false);
  const [locationTick, setLocationTick] = useState(0);

  function show(next: View) {
    setMenuOpen(false);
    setView(next);
    const path = pathFor(next);
    if (window.location.pathname !== path || window.location.hash) {
      window.history.pushState({ view: next }, "", path);
    }
    setLocationTick((tick) => tick + 1);
  }

  useEffect(() => {
    rewriteLabAlias();
    const onPop = () => {
      setMenuOpen(false);
      rewriteLabAlias();
      setView(routeFromLocation());
      setLocationTick((tick) => tick + 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    const timer = window.setTimeout(() => {
      const target = id ? document.getElementById(id) : null;
      const docsScroller = document.querySelector<HTMLElement>(".docs-app main");
      if (target && docsScroller?.contains(target)) {
        const top = target.getBoundingClientRect().top - docsScroller.getBoundingClientRect().top + docsScroller.scrollTop - 16;
        docsScroller.scrollTo({ top, behavior: "auto" });
      } else if (target) {
        target.scrollIntoView({ block: "start" });
      } else if (docsScroller) {
        docsScroller.scrollTo({ top: 0, left: 0, behavior: "auto" });
      } else {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
    }, 40);
    return () => window.clearTimeout(timer);
  }, [view, locationTick]);

  function enter(next: ConsoleIdentity) {
    setIdentity(next);
    show("console");
  }

  function openDocsUrl(url: string) {
    setMenuOpen(false);
    setView("docs");
    const current = `${window.location.pathname}${window.location.hash}`;
    if (current !== url) window.history.pushState({ view: "docs" }, "", url);
    setLocationTick((tick) => tick + 1);
  }

  const networkName = environment === "mainnet" ? "Base" : "Base Sepolia";

  if (view === "docs") {
    return (
      <div className="docs-app">
        <a className="skip" href="#content">Skip to guide</a>
        <header className="docs-topbar edge-header">
          <div className="edge-cluster">
            <a className="docs-wordmark" href="/">Vaulthropic</a>
            <p>Public user guide <span aria-hidden="true">·</span> Base settlement</p>
          </div>
          <a className="docs-return" href="/">Back to Vaulthropic <span aria-hidden="true">↗</span></a>
        </header>
        <main id="content">
          <DocsPage locationKey={locationTick} onNavigate={openDocsUrl} onOpenLab={() => show("lab")} />
        </main>
        <SiteFooter onOpenLab={() => show("lab")} />
      </div>
    );
  }

  return (
    <div className={view === "home" ? "shell shell-home" : "shell"}>
      <a className="skip" href="#content">Skip to content</a>
      <header className="nav edge-header">
        <div className="edge-cluster">
          <a className="brand" href="/" onClick={(event) => followLink(event, () => show("home"))}>Vaulthropic</a>
          <nav id="site-nav" className={menuOpen ? "nav-links is-open" : "nav-links"} aria-label="Primary">
            <a href="/" aria-current={view === "home" ? "page" : undefined} onClick={(event) => followLink(event, () => show("home"))}>Overview</a>
            <a href="/docs#protocols" target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>Protocols</a>
            <a href="/docs/what-is-vaulthropic" target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>Docs</a>
            <a href="/lab" aria-current={view === "lab" ? "page" : undefined} onClick={(event) => followLink(event, () => show("lab"))}>Decision Lab</a>
          </nav>
        </div>
        <div className="edge-cluster edge-end">
          <button className="nav-toggle" type="button" aria-expanded={menuOpen} aria-controls="site-nav" onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? "Close" : "Menu"}
          </button>
          <div className="nav-actions">
            <span className="net-badge" role="status" title={environmentLabel(environment)}>
              <span className="net-long">{networkName}</span>
              <span className="net-short">{environment === "mainnet" ? "Base" : "Sepolia"}</span>
            </span>
            {identity ? (
              <button className="btn quiet" type="button" onClick={() => show("console")}>Console</button>
            ) : (
              <button className="btn primary-solid" type="button" onClick={() => show("signin")}>Sign in</button>
            )}
          </div>
        </div>
      </header>
      <main id="content">
        {view === "home" ? <Home onSignIn={() => show("signin")} onOpenLab={() => show("lab")} /> : null}
        {view === "signin" || (view === "console" && !identity) ? (
          <SignIn environment={environment} onEnvironment={setEnvironment} onEnter={enter} />
        ) : null}
        {view === "console" && identity ? (
          <div className="frame page">
            <Console identity={identity} environment={environment} onEnvironment={setEnvironment} onSignOut={() => { setIdentity(null); show("home"); }} />
          </div>
        ) : null}
        {view === "lab" ? <LabScreen /> : null}
      </main>
      <SiteFooter onOpenLab={() => show("lab")} />
    </div>
  );
}

function SiteFooter({ onOpenLab }: { onOpenLab: () => void }) {
  return (
    <footer className="site-footer">
      <div className="footer-links">
        <nav className="footer-row" aria-label="Footer">
          <a href="/lab" onClick={(event) => followLink(event, onOpenLab)}>Decision Lab</a>
          <a href="/docs/what-is-vaulthropic" target="_blank" rel="noopener noreferrer">What's Vaulthropic</a>
          {FOOTER_RAILS.map(([label, id]) => (
            <a key={id} href={`/docs#${id}`} target="_blank" rel="noopener noreferrer">{label}</a>
          ))}
        </nav>
        <div className="footer-row">
          <a href="/docs#testnet-usdc-faucet" target="_blank" rel="noopener noreferrer">Testnet USDC Faucet</a>
          <a href="/docs#security" target="_blank" rel="noopener noreferrer">Security & Non-Custodial Model</a>
          <span className="footer-copy">© 2026 vaulthropic</span>
        </div>
      </div>
    </footer>
  );
}

function followLink(event: { preventDefault: () => void; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }, action: () => void) {
  if ((event.button ?? 0) !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  action();
}

function Home({ onSignIn, onOpenLab }: { onSignIn: () => void; onOpenLab: () => void }) {
  return (
    <section className="landing">
      <img className="landing-art" src="/hero-robots.jpg" alt="" width={1248} height={832} />
      <div className="landing-top">
        <p className="landing-kicker">Empowering AI-to-AI<br />payment systems.</p>
        <p className="landing-badge">Policy gate active</p>
      </div>
      <div className="landing-bottom">
        <h1>On-chain guardrails for<br />autonomous agent payments.</h1>
        <p className="landing-lede">Blockchain settlement. Non-custodial caps. Verifiable proof.<br />Enforce the limit before the transaction lands.</p>
        <p className="landing-prompt">Try a decision</p>
        <div className="landing-actions">
          <a className="btn accent-yellow" href="/lab" onClick={(event) => followLink(event, onOpenLab)}>Decision Lab</a>
          <button className="btn primary-solid" type="button" onClick={onSignIn}>Create session</button>
        </div>
      </div>
    </section>
  );
}

function LabScreen() {
  const [mode, setMode] = useState<"mainnet" | "testnet">("testnet");
  const [endpoint, setEndpoint] = useState("");
  const [payTo, setPayTo] = useState("");
  return (
    <section className="lab-screen frame page">
      <div className="mode-tabs" role="tablist" aria-label="Decision Lab mode">
        <button type="button" role="tab" id="lab-tab-mainnet" aria-selected={mode === "mainnet"} aria-controls="lab-panel-mainnet" onClick={() => setMode("mainnet")}>Mainnet</button>
        <button type="button" role="tab" id="lab-tab-testnet" aria-selected={mode === "testnet"} aria-controls="lab-panel-testnet" onClick={() => setMode("testnet")}>Testnet</button>
      </div>
      {mode === "mainnet" ? (
        <div id="lab-panel-mainnet" role="tabpanel" aria-labelledby="lab-tab-mainnet">
          <MainnetGate endpoint={endpoint} payTo={payTo} onEndpoint={setEndpoint} onPayTo={setPayTo} />
        </div>
      ) : (
        <div id="lab-panel-testnet" role="tabpanel" aria-labelledby="lab-tab-testnet">
          <DecisionLab environment="sandbox" lockEnvironment />
        </div>
      )}
    </section>
  );
}

function SignIn({
  environment,
  onEnvironment,
  onEnter,
}: {
  environment: Environment;
  onEnvironment: (environment: Environment) => void;
  onEnter: (identity: ConsoleIdentity) => void;
}) {
  const [userName, setUserName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [walletPreview, setWalletPreview] = useState<{ provider: WalletChoice["provider"]; walletName: string; message: string } | null>(null);
  const [passkeySupport, setPasskeySupport] = useState<"unknown" | "yes" | "no">("unknown");
  const [authTab, setAuthTab] = useState<"wallet" | "passkey" | "oauth">("wallet");
  const previewTicket = useRef(0);
  const passkeyField = useId();
  const showPasskey = passkeySupport === "yes";

  useEffect(() => {
    let cancelled = false;
    void platformPasskeyAvailable().then((available) => {
      if (!cancelled) setPasskeySupport(available ? "yes" : "no");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showPasskey && authTab === "passkey") setAuthTab("wallet");
  }, [showPasskey, authTab]);
  const parsedName = consoleUserName(userName);
  const nameError = userName.trim() && !parsedName.ok ? parsedName.message : null;
  const nameHint = `${passkeyField}-hint`;
  const assertBlocked = userName.trim() !== "" && !parsedName.ok;

  async function run(action: () => Promise<ConsoleIdentity>) {
    setError(null);
    setPending(true);
    try {
      onEnter(await action());
      setPickerOpen(false);
      setWalletPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in stopped.");
    } finally {
      setPending(false);
    }
  }

  function submitPasskey(event: FormEvent) {
    event.preventDefault();
    if (!parsedName.ok) {
      setError(null);
      document.getElementById(passkeyField)?.focus();
      return;
    }
    void run(() => registerPasskey(parsedName.userName));
  }

  function closePicker() {
    if (!pending) {
      previewTicket.current += 1;
      setWalletPreview(null);
      setPickerOpen(false);
    }
  }

  async function stageWallet(choice: WalletChoice) {
    const ticket = ++previewTicket.current;
    setError(null);
    setWalletPreview(null);
    setPending(true);
    try {
      const prepared = await prepareWalletSignIn(environment, choice.provider);
      if (ticket === previewTicket.current) {
        setWalletPreview({ provider: choice.provider, walletName: choice.name, message: prepared.message });
      }
    } catch (caught) {
      if (ticket === previewTicket.current) {
        setError(caught instanceof Error ? caught.message : "Sign-in stopped.");
      }
    } finally {
      if (ticket === previewTicket.current) setPending(false);
    }
  }

  return (
    <section className="signin-stage">
      <div className="signin-frame">
        <div className="auth-tabs" role="tablist" aria-label="Sign-in method">
          {showPasskey ? (
            <button type="button" role="tab" id="tab-passkey" aria-selected={authTab === "passkey"} aria-controls="panel-passkey" onClick={() => setAuthTab("passkey")}>Passkey (Optional)</button>
          ) : null}
          <button type="button" role="tab" id="tab-wallet" aria-selected={authTab === "wallet"} aria-controls="panel-wallet" onClick={() => setAuthTab("wallet")}>Wallet Signature</button>
          <button type="button" role="tab" id="tab-oauth" aria-selected={authTab === "oauth"} aria-controls="panel-oauth" onClick={() => setAuthTab("oauth")}>Continue with OAuth</button>
        </div>
        <div className="panel signin-card">
        <h1>Sign in</h1>
        <p className="note">
          {showPasskey
            ? "A passkey or a wallet signature opens the console for this session. It grants no token allowance, spending key, or session budget."
            : "A wallet signature opens the console for this session. It grants no token allowance, spending key, or session budget."}
        </p>
        {showPasskey && authTab === "passkey" ? (
          <div id="panel-passkey" role="tabpanel" aria-labelledby="tab-passkey">
            <p className="note" id={nameHint}>
              Passkey is optional. It only saves this console session so you can resume it in this browser. Clearing this browser’s cache clears the active console session. A passkey synced by the device stays in the device keychain.
              The field starts empty. Create passkey stays off until the email or username is valid, and that click is the only one that creates a credential. The browser prompt shows only what you type.
              WebAuthn does not confirm the inbox, so an email stays unverified. The passkey user id is a random handle, not a chain address.
              Sign in with passkey stays off until you click it. Leave the field empty to use a passkey already on this device, or type a name to attach an unverified label. This page stores the credential id for the page session and does not check the signature or the sign counter. Neither button creates an EVM or Solana key.
            </p>
            <form className="form" noValidate onSubmit={submitPasskey}>
              <label htmlFor={passkeyField}>Email or username
                <input
                  id={passkeyField}
                  value={userName}
                  placeholder="Email or username"
                  autoComplete="username"
                  spellCheck={false}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? `${passkeyField}-error ${nameHint}` : nameHint}
                  onChange={(event) => {
                    setUserName(event.target.value);
                  }}
                />
              </label>
              {nameError ? <p className="alert" id={`${passkeyField}-error`} role="alert">{nameError}</p> : null}
              <div className="form-actions">
                <button className="btn primary-solid" type="submit" disabled={pending || !parsedName.ok}>Create passkey</button>
                <button
                  className="btn quiet"
                  type="button"
                  disabled={pending || assertBlocked}
                  onClick={() => { void run(() => signInWithPasskey(userName)); }}
                >
                  Sign in with passkey
                </button>
              </div>
            </form>
          </div>
        ) : authTab === "oauth" ? (
          <div id="panel-oauth" role="tabpanel" aria-labelledby="tab-oauth">
            <h2>Continue with OAuth</h2>
            <button className="btn quiet" type="button" disabled>Continue with OAuth</button>
            <p className="note">Coming soon in a later release. OAuth stays off until a private deployment provides an authorization URL.</p>
          </div>
        ) : (
          <div id="panel-wallet" role="tabpanel" aria-labelledby="tab-wallet">
            <h2>Wallet signature</h2>
            <p className="note">Pick a detected browser wallet. That choice asks for an account. The sign-in message is shown here before any signature request.</p>
            <form className="form" onSubmit={(event) => { event.preventDefault(); setError(null); setWalletPreview(null); setPickerOpen(true); }}>
              <EnvironmentField environment={environment} onEnvironment={onEnvironment} />
              <button className="btn primary-solid" type="submit" disabled={pending}>Sign in with wallet</button>
            </form>
          </div>
        )}
        {error && !pickerOpen ? <p className="alert" role="alert">{error}</p> : null}
        </div>
      </div>
      {pickerOpen ? (
        <WalletPicker
          environment={environment}
          pending={pending}
          error={error}
          onClose={closePicker}
          preview={walletPreview}
          onChoose={(choice) => { void stageWallet(choice); }}
          onBack={() => { if (!pending) setWalletPreview(null); }}
          onSign={(preview) => {
            void run(() => signPreparedWallet({
              environment,
              provider: preview.provider,
              walletName: preview.walletName,
              message: preview.message,
            }));
          }}
        />
      ) : null}
    </section>
  );
}

function WalletPicker({
  environment,
  pending,
  error,
  preview,
  onClose,
  onChoose,
  onBack,
  onSign,
}: {
  environment: Environment;
  pending: boolean;
  error: string | null;
  preview: { provider: WalletChoice["provider"]; walletName: string; message: string } | null;
  onClose: () => void;
  onChoose: (choice: WalletChoice) => void;
  onBack: () => void;
  onSign: (preview: { provider: WalletChoice["provider"]; walletName: string; message: string }) => void;
}) {
  const titleId = useId();
  const [wallets, setWallets] = useState<WalletChoice[] | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    void discoverWallets().then((choices) => {
      if (!cancelled) setWallets(choices);
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h2 id={titleId}>Choose a wallet</h2>
          <button className="btn quiet" type="button" onClick={onClose} disabled={pending}>Close</button>
        </div>
        <p className="note">An account request can open the wallet. The signature waits until you approve the message below. It grants zero token allowance, spending key, or session budget, and it does not assign a guard owner or a session signer.</p>
        <p className="note">This proof uses {environmentLabel(environment)}.</p>
        {preview ? (
          <>
            <h3>Sign-in message</h3>
            <pre className="sign-message">{preview.message}</pre>
            <div className="form-actions">
              <button className="btn primary-solid" type="button" disabled={pending} onClick={() => onSign(preview)}>Sign this message</button>
              <button className="btn quiet" type="button" disabled={pending} onClick={onBack}>Back</button>
            </div>
          </>
        ) : (
          <>
            {wallets === null ? <p className="note">Looking for browser wallets.</p> : null}
            {wallets && wallets.length === 0 ? <p className="note">No browser wallet announced itself in this window.</p> : null}
            <div className="wallet-list">
              {wallets?.map((choice) => {
                const icon = walletIconSrc(choice.icon);
                return (
                  <button key={choice.id} className="wallet-choice" type="button" disabled={pending} onClick={() => onChoose(choice)}>
                    {icon ? <img src={icon} alt="" width={28} height={28} /> : <span className="wallet-mark" aria-hidden="true" />}
                    <span>{choice.name}</span>
                  </button>
                );
              })}
              <button className="wallet-choice is-soon" type="button" disabled>
                <span>Other connectors</span>
                <span className="note">Coming soon in a later release.</span>
              </button>
            </div>
          </>
        )}
        {error ? <p className="alert" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

function Console({
  identity,
  environment,
  onEnvironment,
  onSignOut,
}: {
  identity: ConsoleIdentity;
  environment: Environment;
  onEnvironment: (environment: Environment) => void;
  onSignOut: () => void;
}) {
  const policy = useMemo(() => examplePolicy(environment), [environment]);
  const draft = useMemo(() => anchorPreview(environment), [environment]);
  const [record, setRecord] = useState<ApiKeyRecord | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<Uint8Array | null>(null);
  const [code, setCode] = useState("");
  const [totpState, setTotpState] = useState<"idle" | "verified" | "rejected">("idle");
  const [error, setError] = useState<string | null>(null);

  async function issueKey(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const issued = await issueApiKey({ policy, ceiling: "5000000" });
      setToken(issued.token);
      setRecord(issued.record);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Key issuance stopped.");
    }
  }

  async function checkTotp(event: FormEvent) {
    event.preventDefault();
    if (!totpSecret) return;
    const ok = await verifyTotp({ secret: totpSecret, code, unixSeconds: Math.floor(Date.now() / 1000) });
    setTotpState(ok ? "verified" : "rejected");
  }

  return (
    <div className="console-stack">
      <section className="panel">
        <p className="chip">{environmentLabel(environment)}</p>
        <h2>Console</h2>
        {identity.method === "passkey" ? (
          <>
            <p className="mono">
              Passkey · {identity.ceremony === "create" ? "created" : "signed in"}
              {identity.userName ? ` · ${identity.userName}` : ""} · {identity.credentialId.slice(0, 18)}…
            </p>
            {identity.emailStatus === "unverified" ? (
              <p className="status status-step_up" role="status">Unverified email. This build has not confirmed the address.</p>
            ) : identity.emailStatus === "username" ? (
              <p className="note">Username console identity. No email is attached to this sign-in.</p>
            ) : (
              <p className="note">No email or username is attached. The authenticator chose the passkey.</p>
            )}
            {identity.ceremony === "assert" ? (
              <p className="note">This page kept the credential id from the assertion. It did not check the signature or the sign counter.</p>
            ) : (
              <p className="note">This page keeps the new credential id for the session and does not write a user database.</p>
            )}
            <p className="note">This passkey is a console identity. It is not a spending key, and this ceremony did not generate an EVM or Solana key.</p>
          </>
        ) : (
          <>
            <p className="mono">{identity.walletName} · {identity.address}</p>
            <p className="note">Console sign-in proof. This page recovered the signer from the signature and checked the message, domain, chain id, and expiry.</p>
            <p className="note">A deployed console must verify that same signature again, and accept each nonce once, before it trusts the address.</p>
          </>
        )}
        <p className="note">Guard owner is not assigned. Session signer is not assigned. Sign-in does not write either field.</p>
        <div className="toolbar">
          <EnvironmentField environment={environment} onEnvironment={onEnvironment} />
          <button className="btn quiet" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </section>
      <section className="grid-2">
        <article className="panel">
          <h3>Example policy hash</h3>
          <p className="hash">{draft.policyHash}</p>
          <p className="note">This is the canonical example policy for {environmentLabel(environment)}. It is not a policy you committed, and Decision Lab edits do not change this hash. A hash here is not a live anchor commitment. Example per-transaction cap {draft.perTxCap.toString()} minor units. Step-up at {draft.stepUpAbove.toString()}. Reference chain {policy.chains[0]}.</p>
        </article>
        <article className="panel">
          <h3>Page-local API key</h3>
          <p className="note">Ceiling 5 USDC, bound to the example {environmentLabel(environment)} policy. This page creates the token and shows it here. No host stores the hash. Refresh clears it. A <span className="mono">vth_live_</span> prefix is still only a local demo token.</p>
          <form className="form" onSubmit={(event) => void issueKey(event)}>
            <button className="btn primary-solid" type="submit">Issue page-local key</button>
          </form>
          {token ? (
            <>
              <p className="note">Page-local token. It is not registered with a host.</p>
              <p className="hash" role="status">{token}</p>
            </>
          ) : null}
          {record ? <p className="note">Computed here · prefix {record.displayPrefix} · hash {record.hash.slice(0, 16)}… This hash is not saved.</p> : null}
        </article>
      </section>
      <section className="panel">
        <h3>Page-local authenticator step-up</h3>
        <p className="note">The seed stays in this page and is shown below. Verifying a code checks that seed. It does not authorize a payment, and it does not set step-up on the Decision Lab. A deployed console would store the verifier seed in the private identity service.</p>
        <div className="nav-actions">
          <button className="btn quiet" type="button" onClick={() => { setTotpSecret(generateTotpSecret()); setTotpState("idle"); setCode(""); }}>Enroll TOTP</button>
        </div>
        {totpSecret ? (
          <>
            <p className="note">Page-local seed. It is visible in this page and is not stored.</p>
            <p className="hash">{base32Encode(totpSecret)}</p>
          </>
        ) : null}
        <form className="form" onSubmit={(event) => void checkTotp(event)}>
          <label>6-digit code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /></label>
          <button className="btn primary-solid" type="submit" disabled={!totpSecret}>Verify code</button>
        </form>
        {totpState === "verified" ? <p className="status status-step_up" role="status">Step-up factor matched. This did not authorize a payment.</p> : null}
        {totpState === "rejected" ? <p className="status status-block" role="status">TOTP did not match. No payment was authorized.</p> : null}
      </section>
      <p className="note">There is no user dashboard on this page. A dashboard waits until you own a guard account and that owner has committed a policy hash. Sign-in does not create either one. The Decision Lab is a separate screen and does not require this console session.</p>
      {error ? <p className="alert" role="alert">{error}</p> : null}
    </div>
  );
}

function EnvironmentField({ environment, onEnvironment }: { environment: Environment; onEnvironment: (environment: Environment) => void }) {
  const fieldId = useId();
  return (
    <div className="env-field">
      <label htmlFor={fieldId}>Settlement environment
        <select id={fieldId} value={environment} onChange={(event) => onEnvironment(event.target.value as Environment)}>
          {ENVIRONMENTS.map((item) => (
            <option key={item.value} value={item.value}>{item.label} · {item.caip2}</option>
          ))}
        </select>
      </label>
      <p className="note">v1 settlement is Base and Base Sepolia. Policy checks and AttemptLedger stay chain-agnostic across x402, AP2, MPP, and MCP, including later adapter rails.</p>
    </div>
  );
}
