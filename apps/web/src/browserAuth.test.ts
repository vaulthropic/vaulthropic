import { describe, expect, it } from "vitest";
import {
  consoleUserName,
  discoverWallets,
  prepareWalletSignIn,
  platformPasskeyAvailable,
  registerPasskey,
  signInWithPasskey,
  signPreparedWallet,
  walletChoicesFromDiscovery,
  walletIconSrc,
} from "./browserAuth.js";
import type { EthereumProvider } from "./browserAuth.js";

function installPasskeys() {
  const calls: string[] = [];
  const previousNavigator = globalThis.navigator;
  const previousCredential = Object.getOwnPropertyDescriptor(globalThis, "PublicKeyCredential");
  const previousLocation = (globalThis as { location?: { hostname: string; origin: string } }).location;
  const rawId = Uint8Array.from([1, 2, 3, 4]).buffer;
  const userHandle = new TextEncoder().encode("ada@merchant.example").buffer;
  Object.defineProperty(globalThis, "PublicKeyCredential", {
    configurable: true,
    value: function PublicKeyCredential() {},
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      credentials: {
        create: async () => {
          calls.push("create");
          return { rawId, type: "public-key", response: { userHandle } };
        },
        get: async () => {
          calls.push("get");
          return { rawId, type: "public-key", response: { userHandle } };
        },
      },
    },
  });
  (globalThis as { location?: { hostname: string; origin: string } }).location = {
    hostname: "localhost",
    origin: "http://localhost:5173",
  };
  return {
    calls,
    restore() {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator });
      if (previousCredential) Object.defineProperty(globalThis, "PublicKeyCredential", previousCredential);
      else delete (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;
      (globalThis as { location?: { hostname: string; origin: string } }).location = previousLocation;
    },
  };
}

function provider(name = "request-log"): EthereumProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    request: async (args) => {
      calls.push(args.method);
      if (args.method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
      if (args.method === "personal_sign") return `0x${"ab".repeat(65)}`;
      return null;
    },
    isMetaMask: name === "MetaMask",
  };
}

describe("platform passkey availability", () => {
  it("stays hidden unless the platform authenticator check resolves true", async () => {
    const installed = installPasskeys();
    try {
      expect(await platformPasskeyAvailable()).toBe(false);
      (globalThis.PublicKeyCredential as unknown as { isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean> }).isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
      expect(await platformPasskeyAvailable()).toBe(true);
      (globalThis.PublicKeyCredential as unknown as { isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean> }).isUserVerifyingPlatformAuthenticatorAvailable = async () => {
        throw new Error("unavailable");
      };
      expect(await platformPasskeyAvailable()).toBe(false);
    } finally {
      installed.restore();
    }
  });
});

describe("console user name", () => {
  it("accepts an email as unverified and a username as a username", () => {
    expect(consoleUserName("  Ada@Merchant.example ")).toEqual({
      ok: true,
      userName: "ada@merchant.example",
      emailStatus: "unverified",
    });
    expect(consoleUserName("ada")).toEqual({ ok: true, userName: "ada", emailStatus: "username" });
  });

  it("rejects blank and malformed names without a success flag", () => {
    expect(consoleUserName("  ").ok).toBe(false);
    expect(consoleUserName("not-an-email@").ok).toBe(false);
    expect(consoleUserName("ab").ok).toBe(false);
  });
});

describe("wallet discovery", () => {
  it("lists EIP-6963 wallets and does not request accounts", () => {
    const first = provider();
    const duplicate = provider();
    const choices = walletChoicesFromDiscovery({
      announced: [
        { info: { uuid: "a", name: "Harbor", icon: "javascript:alert(1)", rdns: "com.example.harbor" }, provider: first },
        { info: { uuid: "b", name: "Harbor again", icon: "https://cdn.example/icon.png", rdns: "com.example.harbor" }, provider: duplicate },
      ],
      injected: provider("MetaMask"),
    });
    expect(choices).toHaveLength(1);
    expect(choices[0]?.name).toBe("Harbor");
    expect(choices[0]?.icon).toBeUndefined();
    expect(first.calls).toEqual([]);
    expect(duplicate.calls).toEqual([]);
  });

  it("falls back to injected providers when nothing announces", () => {
    const metamask = provider("MetaMask");
    const plain = provider();
    delete plain.isMetaMask;
    const choices = walletChoicesFromDiscovery({
      announced: [],
      injected: { request: async () => [], providers: [metamask, plain] },
    });
    expect(choices.map((choice) => choice.name)).toEqual(["MetaMask", "Browser wallet 2"]);
    expect(metamask.calls).toEqual([]);
  });

  it("keeps unsafe icon URLs out of the picker", () => {
    expect(walletIconSrc("https://cdn.example/icon.png")).toBe("https://cdn.example/icon.png");
    expect(walletIconSrc("data:image/svg+xml,abc")).toBe("data:image/svg+xml,abc");
    expect(walletIconSrc("javascript:alert(1)")).toBeNull();
  });

  it("discovers announced providers without calling them", async () => {
    const calls: string[] = [];
    const wallet = {
      request: async (args: { method: string }) => {
        calls.push(args.method);
        return [];
      },
    };
    const listeners = new Set<(event: Event) => void>();
    const previous = {
      add: globalThis.addEventListener,
      remove: globalThis.removeEventListener,
      dispatch: globalThis.dispatchEvent,
      ethereum: (globalThis as { ethereum?: unknown }).ethereum,
    };
    globalThis.addEventListener = ((type: string, listener: EventListener) => {
      if (type === "eip6963:announceProvider") listeners.add(listener as (event: Event) => void);
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = ((type: string, listener: EventListener) => {
      if (type === "eip6963:announceProvider") listeners.delete(listener as (event: Event) => void);
    }) as typeof globalThis.removeEventListener;
    globalThis.dispatchEvent = ((event: Event) => {
      if (event.type === "eip6963:requestProvider") {
        for (const listener of listeners) {
          listener(new CustomEvent("eip6963:announceProvider", {
            detail: { info: { uuid: "w1", name: "Example Wallet", rdns: "com.example.wallet", icon: "https://cdn.example/w.png" }, provider: wallet },
          }));
        }
      }
      return true;
    }) as typeof globalThis.dispatchEvent;
    try {
      const choices = await discoverWallets(0);
      expect(choices.map((choice) => choice.name)).toEqual(["Example Wallet"]);
      expect(calls).toEqual([]);
    } finally {
      globalThis.addEventListener = previous.add;
      globalThis.removeEventListener = previous.remove;
      globalThis.dispatchEvent = previous.dispatch;
      if (previous.ethereum === undefined) delete (globalThis as { ethereum?: unknown }).ethereum;
      else (globalThis as { ethereum?: unknown }).ethereum = previous.ethereum;
    }
  });
});

describe("sign-in ceremonies", () => {
  it("stops an invalid passkey name before WebAuthn", async () => {
    const passkeys = installPasskeys();
    try {
      await expect(registerPasskey(" ")).rejects.toThrow(/Enter an email or a username/);
      await expect(signInWithPasskey("not-an-email@")).rejects.toThrow(/Enter a valid email/);
      expect(passkeys.calls).toEqual([]);
    } finally {
      passkeys.restore();
    }
  });

  it("creates a passkey only from the create ceremony and mints no chain key", async () => {
    const passkeys = installPasskeys();
    try {
      const identity = await registerPasskey("Ada@Merchant.example");
      expect(passkeys.calls).toEqual(["create"]);
      expect(identity).toEqual({
        method: "passkey",
        ceremony: "create",
        userName: "ada@merchant.example",
        credentialId: "AQIDBA",
        emailStatus: "unverified",
      });
      expect(JSON.stringify(identity)).not.toMatch(/0x[a-fA-F0-9]{40}/);
    } finally {
      passkeys.restore();
    }
  });

  it("asserts a discoverable passkey without reading the user handle or minting a key", async () => {
    const passkeys = installPasskeys();
    try {
      const unlabeled = await signInWithPasskey("  ");
      expect(unlabeled).toEqual({
        method: "passkey",
        ceremony: "assert",
        userName: null,
        credentialId: "AQIDBA",
        emailStatus: "unlinked",
      });
      const labeled = await signInWithPasskey("ada");
      expect(labeled).toMatchObject({
        ceremony: "assert",
        userName: "ada",
        emailStatus: "username",
      });
      expect(passkeys.calls).toEqual(["get", "get"]);
      expect(JSON.stringify(labeled)).not.toContain("ada@merchant.example");
      expect(JSON.stringify(labeled)).not.toMatch(/0x[a-fA-F0-9]{40}/);
    } finally {
      passkeys.restore();
    }
  });

  it("previews the sign-in message before personal_sign, then rejects a signature that does not recover", async () => {
    const chosen = provider("MetaMask");
    const ignored = provider();
    let signed = "";
    chosen.request = async (args) => {
      chosen.calls.push(args.method);
      if (args.method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
      if (args.method === "personal_sign") {
        signed = String(args.params?.[0] ?? "");
        return `0x${"ab".repeat(65)}`;
      }
      return null;
    };
    (globalThis as { location?: { hostname: string; origin: string } }).location = {
      hostname: "localhost",
      origin: "http://localhost:5173",
    };
    const preview = await prepareWalletSignIn("sandbox", chosen);
    expect(chosen.calls).toEqual(["eth_requestAccounts"]);
    expect(preview.message).toContain("Chain ID: 84532");
    expect(preview.message).toContain("does not grant a token allowance");
    expect(ignored.calls).toEqual([]);
    await expect(
      signPreparedWallet({ environment: "sandbox", provider: chosen, walletName: "MetaMask", message: preview.message }),
    ).rejects.toThrow(/does not match/);
    expect(chosen.calls).toEqual(["eth_requestAccounts", "personal_sign"]);
    expect(hexToUtf8(signed)).toBe(preview.message);
  });
});

function hexToUtf8(hex: string): string {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = body.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [];
  return new TextDecoder().decode(Uint8Array.from(bytes));
}
