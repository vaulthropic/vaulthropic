import { createSignInMessage, passkeyCreationOptions, passkeyRequestOptions, verifySignInMessage } from "@vaulthropic/core";
import type { Environment } from "@vaulthropic/core";

export type PasskeyEmailStatus = "unverified" | "username" | "unlinked";

export type ConsoleIdentity =
  | {
      method: "passkey";
      ceremony: "create" | "assert";
      userName: string | null;
      credentialId: string;
      emailStatus: PasskeyEmailStatus;
    }
  | { method: "wallet"; address: string; walletName: string };

export type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  isRabby?: boolean;
  providers?: EthereumProvider[];
};

export type Eip6963ProviderDetail = {
  info: { uuid: string; name: string; icon?: string; rdns: string };
  provider: EthereumProvider;
};

export type WalletChoice = {
  id: string;
  name: string;
  rdns?: string;
  icon?: string;
  provider: EthereumProvider;
};

export type ConsoleUserName =
  | { ok: true; userName: string; emailStatus: "unverified" | "username" }
  | { ok: false; message: string };

const USERNAME = /^(?=.{3,64}$)[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Classify a console sign-in name. This does not start WebAuthn. */
export function consoleUserName(value: string): ConsoleUserName {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, message: "Enter an email or a username. Create passkey stays off until that name is valid." };
  }
  if (trimmed.includes("@") || trimmed.includes(" ")) {
    if (!EMAIL.test(trimmed) || trimmed.length > 254) {
      return { ok: false, message: "Enter a valid email. Both passkey buttons stay off until that name is valid." };
    }
    return { ok: true, userName: trimmed.toLowerCase(), emailStatus: "unverified" };
  }
  if (!USERNAME.test(trimmed)) {
    return { ok: false, message: "Use an email address or a username of 3–64 letters, numbers, dots, or hyphens. Both passkey buttons stay off until that name is valid." };
  }
  return { ok: true, userName: trimmed, emailStatus: "username" };
}

export function walletIconSrc(icon: string | undefined): string | null {
  if (!icon) return null;
  if (icon.startsWith("data:image/") || icon.startsWith("https://")) return icon;
  return null;
}

/**
 * Turn EIP-6963 announcements, or a legacy injected provider, into picker rows.
 * Reading this list does not call `eth_requestAccounts`.
 */
export function walletChoicesFromDiscovery(input: {
  announced: Eip6963ProviderDetail[];
  injected?: EthereumProvider | null;
}): WalletChoice[] {
  const seen = new Set<string>();
  const announced: WalletChoice[] = [];
  for (const detail of input.announced) {
    const uuid = detail.info?.uuid?.trim();
    const name = detail.info?.name?.trim();
    if (!uuid || !name || typeof detail.provider?.request !== "function") continue;
    const key = detail.info.rdns?.trim().toLowerCase() || uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    const icon = walletIconSrc(detail.info.icon);
    announced.push({
      id: uuid,
      name,
      rdns: detail.info.rdns,
      ...(icon ? { icon } : {}),
      provider: detail.provider,
    });
  }
  if (announced.length > 0) return announced;

  const injected = input.injected;
  const providers = injected?.providers?.length ? injected.providers : injected ? [injected] : [];
  return providers
    .filter((provider) => typeof provider?.request === "function")
    .map((provider, index) => ({
      id: `injected-${index}`,
      name: injectedWalletName(provider, index, providers.length),
      provider,
    }));
}

/** Listen for EIP-6963 announcements. This does not request accounts or a signature. */
export function discoverWallets(timeoutMs = 200): Promise<WalletChoice[]> {
  const announced: Eip6963ProviderDetail[] = [];
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    if (detail?.info && detail.provider) announced.push(detail);
  };
  globalThis.addEventListener?.("eip6963:announceProvider", onAnnounce);
  globalThis.dispatchEvent?.(new Event("eip6963:requestProvider"));
  return new Promise((resolve) => {
    setTimeout(() => {
      globalThis.removeEventListener?.("eip6963:announceProvider", onAnnounce);
      const injected = (globalThis as { ethereum?: EthereumProvider }).ethereum ?? null;
      resolve(walletChoicesFromDiscovery({ announced, injected }));
    }, timeoutMs);
  });
}

export async function registerPasskey(userName: string): Promise<ConsoleIdentity> {
  const parsed = consoleUserName(userName);
  if (!parsed.ok) throw new Error(parsed.message);
  const credentials = requirePasskeys();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const publicKey = passkeyCreationOptions({
    challenge,
    userId,
    userName: parsed.userName,
    rpId: relyingParty(),
  });
  const credential = (await credentials.create({
    publicKey: {
      ...publicKey,
      challenge: copyBytes(publicKey.challenge),
      user: { ...publicKey.user, id: copyBytes(publicKey.user.id) },
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("The passkey ceremony was cancelled.");
  return passkeyIdentity("create", credential.rawId, parsed);
}

/**
 * Assert a discoverable passkey. Call this only from the Sign in with passkey click.
 * An empty field is allowed. A non-empty field must already parse, and it is only a label.
 * This build does not verify the signature or the sign counter, and it does not mint a chain key.
 */
export async function signInWithPasskey(userName: string): Promise<ConsoleIdentity> {
  const trimmed = userName.trim();
  const parsed = trimmed ? consoleUserName(trimmed) : null;
  if (parsed && !parsed.ok) throw new Error(parsed.message);
  const credentials = requirePasskeys();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const publicKey = passkeyRequestOptions({
    challenge,
    rpId: relyingParty(),
  });
  const credential = (await credentials.get({
    publicKey: {
      challenge: copyBytes(publicKey.challenge),
      rpId: publicKey.rpId,
      userVerification: publicKey.userVerification,
      timeout: publicKey.timeout,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("The passkey ceremony was cancelled.");
  // The authenticator user handle is an opaque id. It is not an email, a chain address, or a spending key.
  return passkeyIdentity("assert", credential.rawId, parsed?.ok ? parsed : null);
}

function requirePasskeys(): CredentialsContainer {
  // shortcut: credential id lives in the page session only. Upgrade when a private identity service stores the COSE public key, sign counter, and email verification status.
  if (!("PublicKeyCredential" in globalThis) || !navigator.credentials?.create || !navigator.credentials?.get) {
    throw new Error("This browser does not expose passkeys.");
  }
  return navigator.credentials;
}

/** True only when this browser reports a user-verifying platform authenticator. */
export async function platformPasskeyAvailable(): Promise<boolean> {
  const host = typeof window === "undefined" ? globalThis : window;
  const credential = (host as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } }).PublicKeyCredential;
  if (typeof credential?.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return false;
  try {
    return (await credential.isUserVerifyingPlatformAuthenticatorAvailable()) === true;
  } catch {
    return false;
  }
}

function passkeyIdentity(
  ceremony: "create" | "assert",
  rawId: ArrayBuffer,
  parsed: { userName: string; emailStatus: "unverified" | "username" } | null,
): ConsoleIdentity {
  return {
    method: "passkey",
    ceremony,
    userName: parsed?.userName ?? null,
    credentialId: bufferToBase64Url(rawId),
    emailStatus: parsed?.emailStatus ?? "unlinked",
  };
}

export type WalletSignInPreview = {
  address: string;
  message: string;
};

/** Ask the chosen provider for an account and build the message. This does not request a signature. */
export async function prepareWalletSignIn(
  environment: Environment,
  provider: EthereumProvider,
): Promise<WalletSignInPreview> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("The wallet returned no account.");
  const issued = new Date();
  const message = createSignInMessage({
    domain: signInDomain(),
    address,
    nonce: randomNonce(),
    issuedAt: issued.toISOString().replace(/\.\d{3}Z$/, "Z"),
    expirationTime: new Date(issued.getTime() + 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    environment,
    uri: globalThis.location.origin,
  });
  return { address: message.split("\n")[1] ?? address, message };
}

/** Sign the exact previewed message, then recover the signer. Call this only from Sign this message. */
export async function signPreparedWallet(input: {
  environment: Environment;
  provider: EthereumProvider;
  walletName: string;
  message: string;
  now?: number;
}): Promise<ConsoleIdentity> {
  const address = input.message.split("\n")[1];
  if (!address) throw new Error("Sign-in message is missing an address.");
  const signature = (await input.provider.request({
    method: "personal_sign",
    params: [toHex(input.message), address],
  })) as string;
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    throw new Error("The wallet did not return a signature.");
  }
  const verified = await verifySignInMessage({
    message: input.message,
    signature,
    now: input.now ?? Date.now(),
    environment: input.environment,
  });
  return { method: "wallet", address: verified.address, walletName: input.walletName };
}

function injectedWalletName(provider: EthereumProvider, index: number, total: number): string {
  const base = provider.isRabby
    ? "Rabby"
    : provider.isCoinbaseWallet
      ? "Coinbase Wallet"
      : provider.isBraveWallet
        ? "Brave Wallet"
        : provider.isMetaMask
          ? "MetaMask"
          : "Browser wallet";
  return total > 1 && base === "Browser wallet" ? `Browser wallet ${index + 1}` : base;
}

function relyingParty(): string {
  const host = globalThis.location.hostname;
  if (host === "localhost" || host === "vaulthropic.com") return host;
  throw new Error("Passkey sign-in in this build expects localhost or vaulthropic.com.");
}

function signInDomain(): "localhost" | "vaulthropic.com" {
  const host = globalThis.location.hostname;
  if (host === "localhost" || host === "vaulthropic.com") return host;
  throw new Error("Wallet sign-in in this build expects localhost or vaulthropic.com.");
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toHex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
