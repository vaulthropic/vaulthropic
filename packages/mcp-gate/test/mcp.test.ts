import { examplePolicy } from "@vaulthropic/core";
import { describe, expect, it } from "vitest";
import { gateMcpToolCall } from "../src/index.js";

const NOW = 1_700_000_000;
const usage = { spent: "0", windowStartedAt: NOW - 5 };

describe("MCP gate", () => {
  it("allows an allowlisted tool and blocks a tool the prompt tries to invent", () => {
    const policy = examplePolicy();
    expect(
      gateMcpToolCall({
        policy,
        usage,
        now: NOW,
        chain: "eip155:84532",
        call: { server: "https://mcp.example.com", tool: "search", arguments: { query: "caps" } },
      }).outcome,
    ).toBe("allow");

    expect(
      gateMcpToolCall({
        policy,
        usage,
        now: NOW,
        chain: "eip155:84532",
        call: { server: "https://mcp.example.com", tool: "transfer", arguments: { amount: "1", to: policy.allowlists.recipients[0] } },
      }).reason,
    ).toBe("BLOCK_MCP_TOOL_NOT_ALLOWLISTED");
  });

  it("applies the spend cap when an allowlisted tool carries a payment", () => {
    const policy = examplePolicy();
    const decision = gateMcpToolCall({
      policy,
      usage,
      now: NOW,
      chain: "eip155:84532",
      call: {
        server: "https://mcp.example.com/",
        tool: "quote",
        arguments: {
          amount: "25000001",
          payTo: policy.allowlists.recipients[0],
          asset: "USDC",
          url: "https://merchant.example/quote",
        },
      },
    });
    expect(decision.reason).toBe("BLOCK_PER_TX_CAP");
  });

  it("blocks an unknown server before looking at arguments", () => {
    const decision = gateMcpToolCall({
      policy: examplePolicy(),
      usage,
      now: NOW,
      chain: "eip155:84532",
      call: { server: "https://evil.example", tool: "search" },
    });
    expect(decision.reason).toBe("BLOCK_MCP_SERVER_NOT_ALLOWLISTED");
  });
});
