import { recoverMessageAddress } from "viem";
import { checksumAddress } from "../address.js";
import type { Environment } from "../types.js";

const ALLOWED_DOMAINS = new Set(["vaulthropic.com", "localhost"]);
const STATEMENT =
  "Sign in to Vaulthropic. This signature proves control of this address. It does not grant a token allowance, a session spend right, or custody of funds.";
const MAX_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

export type SignInMessageInput = {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  environment: Environment;
  uri?: string;
};

export type VerifiedSignIn = {
  address: `0x${string}`;
  domain: "localhost" | "vaulthropic.com";
  nonce: string;
  chainId: 8453 | 84532;
};

/** EIP-4361 style proof of address control. The text grants no allowance and no session spend. */
export function createSignInMessage(input: SignInMessageInput): string {
  if (!ALLOWED_DOMAINS.has(input.domain)) {
    throw new Error("Sign-in domain must be vaulthropic.com or localhost.");
  }
  if (!/^[A-Za-z0-9]{8,64}$/.test(input.nonce)) throw new Error("Nonce must be 8–64 alphanumeric characters.");
  if (!isIsoTime(input.issuedAt) || !isIsoTime(input.expirationTime)) {
    throw new Error("Issued At and Expiration Time must be ISO-8601 timestamps.");
  }
  const issuedMs = Date.parse(input.issuedAt);
  const expiresMs = Date.parse(input.expirationTime);
  if (expiresMs <= issuedMs || expiresMs - issuedMs > MAX_TTL_MS) {
    throw new Error("Sign-in message must expire within 10 minutes.");
  }
  const chainId = input.environment === "mainnet" ? 8453 : 84532;
  const address = checksumAddress(input.address);
  const uri = assertSignInUri(input.domain, input.uri ?? (input.domain === "localhost" ? "http://localhost" : "https://vaulthropic.com"));
  return [
    `${input.domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    STATEMENT,
    "",
    `URI: ${uri}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expirationTime}`,
  ].join("\n");
}

/**
 * Recover the signer of a console sign-in message and check the text this page would preview.
 * A deployed console calls this again, and accepts each nonce once, before it trusts the address.
 * The recovered address is a console proof. It is not a guard owner and not a session signer.
 */
export async function verifySignInMessage(input: {
  message: string;
  signature: string;
  now: number;
  environment: Environment;
}): Promise<VerifiedSignIn> {
  const parsed = parseSignInMessage(input.message, input.environment);
  if (!Number.isFinite(input.now)) throw new Error("Sign-in time is invalid.");
  if (input.now < parsed.issuedMs - CLOCK_SKEW_MS) throw new Error("Sign-in message is not valid yet.");
  if (input.now >= parsed.expiresMs) throw new Error("Sign-in message has expired.");
  if (!/^0x[0-9a-fA-F]{130}$/.test(input.signature)) {
    throw new Error("The signature does not match this sign-in message.");
  }
  let recovered: `0x${string}`;
  try {
    recovered = checksumAddress(
      await recoverMessageAddress({ message: input.message, signature: input.signature as `0x${string}` }),
    );
  } catch {
    throw new Error("The signature does not match this sign-in message.");
  }
  if (recovered !== parsed.address) {
    throw new Error("The signature was not made by the address in the sign-in message.");
  }
  return { address: recovered, domain: parsed.domain, nonce: parsed.nonce, chainId: parsed.chainId };
}

function parseSignInMessage(message: string, environment: Environment): {
  domain: "localhost" | "vaulthropic.com";
  address: `0x${string}`;
  chainId: 8453 | 84532;
  nonce: string;
  issuedMs: number;
  expiresMs: number;
} {
  const lines = message.split("\n");
  if (lines.length !== 11) throw new Error("Sign-in message has the wrong shape.");
  const domainMatch = /^([a-z0-9.-]+) wants you to sign in with your Ethereum account:$/.exec(lines[0] ?? "");
  const domain = domainMatch?.[1];
  if (domain !== "localhost" && domain !== "vaulthropic.com") {
    throw new Error("Sign-in domain must be vaulthropic.com or localhost.");
  }
  let address: `0x${string}`;
  try {
    address = checksumAddress(lines[1] ?? "");
  } catch {
    throw new Error("Sign-in message address is invalid.");
  }
  if (lines[2] !== "" || lines[3] !== STATEMENT || lines[4] !== "") {
    throw new Error("Sign-in statement does not match.");
  }
  const uriLine = lines[5] ?? "";
  if (!uriLine.startsWith("URI: ")) throw new Error("Sign-in URI is invalid.");
  assertSignInUri(domain, uriLine.slice(5));
  if (lines[6] !== "Version: 1") throw new Error("Sign-in version is not supported.");
  const expectedChain = environment === "mainnet" ? "8453" : "84532";
  if (lines[7] !== `Chain ID: ${expectedChain}`) {
    throw new Error("Sign-in chain does not match the selected environment.");
  }
  const nonceLine = lines[8] ?? "";
  const nonce = nonceLine.startsWith("Nonce: ") ? nonceLine.slice("Nonce: ".length) : "";
  if (!/^[A-Za-z0-9]{8,64}$/.test(nonce)) throw new Error("Sign-in nonce is invalid.");
  const issuedAt = valueAfter(lines[9] ?? "", "Issued At: ");
  const expirationTime = valueAfter(lines[10] ?? "", "Expiration Time: ");
  if (!isIsoTime(issuedAt) || !isIsoTime(expirationTime)) throw new Error("Sign-in timestamps are invalid.");
  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expirationTime);
  if (expiresMs <= issuedMs || expiresMs - issuedMs > MAX_TTL_MS) {
    throw new Error("Sign-in message must expire within 10 minutes.");
  }
  return { domain, address, chainId: environment === "mainnet" ? 8453 : 84532, nonce, issuedMs, expiresMs };
}

function assertSignInUri(domain: string, uri: string): string {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("Sign-in URI is invalid.");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Sign-in URI must be an origin.");
  }
  if (domain === "localhost") {
    if (url.protocol !== "http:" || url.hostname !== "localhost") {
      throw new Error("Local sign-in URI must use http://localhost.");
    }
  } else if (url.protocol !== "https:" || url.hostname !== "vaulthropic.com" || url.port) {
    throw new Error("Sign-in URI must use https://vaulthropic.com.");
  }
  return uri;
}

function valueAfter(line: string, prefix: string): string {
  return line.startsWith(prefix) ? line.slice(prefix.length) : "";
}

function isIsoTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}
