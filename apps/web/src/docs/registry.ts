export type DocSection = {
  id: string;
  label: string;
  /** Extra hashes that highlight this item, such as a protocol heading inside Protocols. */
  aliases?: readonly string[];
};

export type DocPage = {
  id: string;
  path: string;
  menuLabel: string;
  eyebrow: string;
  title: string;
  lede: string;
  sections: readonly DocSection[];
};

/**
 * Add a page by creating `pages/<id>.mdx` and one entry here.
 * Guide section ids stay on `/docs#...` so existing footer links keep working.
 */
export const docPages: readonly DocPage[] = [
  {
    id: "what-is-vaulthropic",
    path: "/docs/what-is-vaulthropic",
    menuLabel: "What's Vaulthropic",
    eyebrow: "Plain English",
    title: "What's Vaulthropic",
    lede: "Vaulthropic checks an agent's payment against rules you set, before anything is signed or settled. The funds stay in an account you own.",
    sections: [
      { id: "what", label: "What it is" },
      { id: "boundary", label: "What it is not" },
      { id: "checks", label: "What gets checked" },
      { id: "learn", label: "How you learn it" },
      { id: "work", label: "Work the caps make safer" },
      { id: "sign-in", label: "How sign-in works", aliases: ["passkey", "wallet", "step-up", "oauth", "api-key"] },
    ],
  },
  {
    id: "guide",
    path: "/docs",
    menuLabel: "Guide",
    eyebrow: "User and developer guide",
    title: "Set up a session without guessing.",
    lede: "Vaulthropic decides allow, step-up, or block before an agent signs. v1 settlement targets are Base (eip155:8453) and Base Sepolia (eip155:84532). The policy engine and AttemptLedger stay chain-agnostic.",
    sections: [
      { id: "overview", label: "Overview" },
      { id: "networks", label: "Networks" },
      { id: "base-mainnet", label: "Base mainnet" },
      { id: "base-sepolia", label: "Base Sepolia" },
      { id: "testnet-usdc-faucet", label: "Testnet USDC" },
      { id: "adapters", label: "Adapters" },
      { id: "session-setup", label: "Session setup" },
      { id: "identity", label: "Console identity" },
      { id: "ceilings", label: "Ceilings" },
      { id: "verify", label: "Verify, then promote" },
      { id: "protocols", label: "Protocols", aliases: ["x402", "ap2", "mpp", "mcp"] },
      { id: "attempt-ledger", label: "AttemptLedger", aliases: ["reason-codes"] },
      { id: "security", label: "Security" },
    ],
  },
  {
    id: "usdc-apis",
    path: "/docs/usdc-apis",
    menuLabel: "APIs accepting USDC",
    eyebrow: "x402 pay-per-call APIs",
    title: "APIs Accepting USDC Per Request.",
    lede: "These are HTTP 402 metered endpoints, also called x402 pay-per-call APIs or agentic USDC payment endpoints. A call without payment returns a challenge. The signature is released only after the endpoint, the payTo, and the ceilings allow that exact retry.",
    sections: [
      { id: "names", label: "What they are called" },
      { id: "flow", label: "402, then retry" },
      { id: "endpoints", label: "Endpoint URLs" },
      { id: "payto", label: "Receiving payTo", aliases: ["challenge"] },
      { id: "guardrails", label: "Guardrails" },
      { id: "brave", label: "Brave Search" },
      { id: "twitter", label: "TwitterAPI.io" },
      { id: "coingecko", label: "CoinGecko" },
      { id: "massive", label: "Massive" },
      { id: "runapi", label: "RunAPI" },
      { id: "payapi", label: "PayAPI Market" },
    ],
  },
];

export type DocNavItem = {
  kind: "label" | "section";
  key: string;
  label: string;
  page: DocPage;
  section?: DocSection;
  href?: string;
};

export function normalizeDocPath(path: string): string {
  const stripped = path.replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped;
}

export function pageForPath(path: string): DocPage | undefined {
  return docPages.find((page) => page.path === normalizeDocPath(path));
}

export function sectionHref(page: DocPage, sectionId: string): string {
  return `${page.path}#${sectionId}`;
}

export function docNavItems(): DocNavItem[] {
  const items: DocNavItem[] = [];
  for (const page of docPages) {
    items.push({ kind: "label", key: `label-${page.id}`, label: page.menuLabel, page });
    for (const section of page.sections) {
      items.push({
        kind: "section",
        key: `${page.id}-${section.id}`,
        label: section.label,
        page,
        section,
        href: sectionHref(page, section.id),
      });
    }
  }
  return items;
}

export function currentSectionId(page: DocPage, hash: string): string {
  if (!hash) return page.sections[0]?.id ?? "";
  const direct = page.sections.find((section) => section.id === hash || section.aliases?.includes(hash));
  return direct?.id ?? hash;
}
