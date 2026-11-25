import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EndpointSetup, mdxComponents, PAYTO_VERIFY } from "./components.js";
import { followPlainClick } from "./follow.js";
import { currentSectionId, docPages, normalizeDocPath, pageForPath, sectionHref } from "./registry.js";

const guideSource = readFileSync(new URL("./pages/guide.mdx", import.meta.url), "utf8");
const usdcSource = readFileSync(new URL("./pages/usdc-apis.mdx", import.meta.url), "utf8");

const footerHashes = [
  "base-mainnet",
  "base-sepolia",
  "testnet-usdc-faucet",
  "ceilings",
  "attempt-ledger",
  "security",
  "x402",
  "ap2",
  "mpp",
  "mcp",
];

describe("docs registry", () => {
  it("keeps guide hashes on /docs and adds the USDC page beside them", () => {
    expect(docPages.map((page) => page.path)).toEqual(["/docs/what-is-vaulthropic", "/docs", "/docs/usdc-apis"]);
    expect(docPages[0]?.menuLabel).toBe("What's Vaulthropic");
    const aboutSource = readFileSync(new URL("./pages/what-is-vaulthropic.mdx", import.meta.url), "utf8");
    expect(aboutSource).toContain("It does not hold customer deposits, pooled funds, or root private keys.");
    expect(aboutSource).toContain("It is not affiliated with the operators of Base, Circle, or the authors of x402, AP2, MPP, or MCP.");
    expect(aboutSource).not.toContain("Vaulthrobic");
    const guide = pageForPath("/docs/");
    expect(guide?.id).toBe("guide");
    expect(sectionHref(guide!, "ceilings")).toBe("/docs#ceilings");
    expect(pageForPath("/docs/usdc-apis")?.sections.map((section) => section.id)).toEqual([
      "names",
      "flow",
      "endpoints",
      "payto",
      "guardrails",
      "brave",
      "twitter",
      "coingecko",
      "massive",
      "runapi",
      "payapi",
    ]);
    expect(currentSectionId(pageForPath("/docs/usdc-apis")!, "challenge")).toBe("payto");
    expect(pageForPath("/docs/missing")).toBeUndefined();
    expect(normalizeDocPath("/docs/usdc-apis/")).toBe("/docs/usdc-apis");
    for (const hash of footerHashes) {
      const id = currentSectionId(guide!, hash);
      expect(guide!.sections.some((section) => section.id === id)).toBe(true);
      expect(guideSource).toContain(`id="${hash}"`);
    }
    expect(guideSource).toContain('DocAnchor href="https://faucet.circle.com/"');
    expect(guideSource).not.toContain("<a ");
    expect(currentSectionId(guide!, "x402")).toBe("protocols");
    expect(currentSectionId(guide!, "reason-codes")).toBe("attempt-ledger");
    expect(currentSectionId(guide!, "")).toBe("overview");
  });
});

describe("docs components", () => {
  it("follows a plain click and leaves modified clicks alone", () => {
    let prevented = false;
    const event = { preventDefault: () => { prevented = true; }, button: 0 };
    expect(followPlainClick(event)).toBe(true);
    expect(prevented).toBe(true);
    expect(followPlainClick({ preventDefault: () => undefined, button: 0, metaKey: true })).toBe(false);
  });

  it("prints the live payTo reminder in every endpoint block", () => {
    const html = renderToStaticMarkup(createElement(EndpointSetup, {
      docsHref: "https://example.com/docs",
      host: "https://example.com",
      children: "Route notes",
    }));
    expect(html).toContain(PAYTO_VERIFY);
    expect(html).toContain("https://example.com/docs");
    expect(html).toContain("https://example.com");
    expect(html).toContain('target="_blank"');
    expect(html).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(mdxComponents.DocAnchor).toBeTypeOf("function");
    expect(mdxComponents.LabLink).toBeTypeOf("function");
    expect(renderToStaticMarkup(createElement(mdxComponents.LabLink, null, "Decision Lab"))).toContain('href="/lab"');
    expect(mdxComponents.Callout).toBeTypeOf("function");
  });
});

describe("USDC API article", () => {
  it("links the official provider docs and does not invent a payTo", () => {
    const links = [
      "https://api-dashboard.search.brave.com/documentation/guides/agent-payments",
      "https://twitterapi.io/blog/x402-twitter-api",
      "https://docs.coingecko.com/ai-integration/x402",
      "https://massive.com/docs",
      "https://massive.com/docs/ai-tools/x402",
      "https://runapi.ai/x402",
      "https://payapi.market/",
    ];
    for (const link of links) expect(usdcSource).toContain(link);
    expect(usdcSource).toContain("x402 pay-per-call APIs");
    expect(usdcSource).toContain("HTTP 402 metered endpoints");
    expect(usdcSource.toLowerCase()).toContain("agentic usdc payment endpoints");
    expect(usdcSource).toContain("not-deployed");
    expect(usdcSource).toContain("PAYMENT-SIGNATURE");
    expect(usdcSource).toContain("BLOCK_ENDPOINT_NOT_ALLOWLISTED");
    expect(usdcSource).toContain("https://merchant.example");
    expect(usdcSource).toContain("Decision Lab");
    expect(usdcSource).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(usdcSource.match(/<EndpointSetup/g)).toHaveLength(6);
  });
});
