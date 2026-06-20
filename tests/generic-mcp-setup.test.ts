import assert from "node:assert/strict";
import test from "node:test";

import {
  formatGenericMcpSetupResult,
  parseGenericMcpSetupArgs,
  setupGenericMcpSource
} from "../src/generic-mcp-setup.js";
import type { CoffeePriceConfig, OfferCandidate } from "../src/types.js";

const CONFIG = {
  defaultAddressAlias: "公司",
  addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
  browserProfilePath: ".runtime/browser-profile",
  brands: [{ name: "瑞幸", enabled: true }],
  sources: { priceBook: true, cityBenchmark: true, meituan: false, eleme: false, brandOfficial: false },
  externalSources: [
    {
      id: "genericMcp",
      label: "旧 MCP",
      enabled: false,
      type: "mcp",
      endpoint: "http://127.0.0.1:1/mcp",
      toolName: "old_tool"
    }
  ]
};

test("parses generic MCP setup CLI options and env defaults", () => {
  const parsed = parseGenericMcpSetupArgs(
    [
      "--config", "config.json",
      "--id", "coffeeLive",
      "--label", "实时咖啡 MCP",
      "--tool-result-path", "data.snapshot",
      "--timeout-ms", "90000",
      "--bearer-token-env", "COFFEE_TOKEN",
      "--sample", "查公司附近拿铁",
      "--address", "公司",
      "--probe-call",
      "--dry-run"
    ],
    {
      COFFEE_PRICE_MCP_URL: "http://127.0.0.1:8787/mcp",
      COFFEE_PRICE_MCP_TOOL: "coffee_price_search"
    }
  );

  assert.equal(parsed.configPath, "config.json");
  assert.equal(parsed.id, "coffeeLive");
  assert.equal(parsed.label, "实时咖啡 MCP");
  assert.equal(parsed.transport, "http");
  assert.equal(parsed.endpoint, "http://127.0.0.1:8787/mcp");
  assert.equal(parsed.toolName, "coffee_price_search");
  assert.equal(parsed.toolResultPath, "data.snapshot");
  assert.equal(parsed.timeoutMs, 90000);
  assert.equal(parsed.bearerTokenEnv, "COFFEE_TOKEN");
  assert.equal(parsed.sampleMessage, "查公司附近拿铁");
  assert.equal(parsed.addressAlias, "公司");
  assert.equal(parsed.probeCall, true);
  assert.equal(parsed.dryRun, true);
});

test("parses stdio MCP setup CLI options", () => {
  const parsed = parseGenericMcpSetupArgs([
    "--transport", "stdio",
    "--command", "npx",
    "--args-json", "[\"-y\",\"github:owner/coffee-mcp\"]",
    "--env-json", "{\"STATIC_FLAG\":\"1\"}",
    "--env-from-json", "{\"CHILD_TOKEN\":\"PARENT_TOKEN\"}",
    "--tool", "coffee_price_search",
    "--token-env-name", "COFFEE_MCP_TOKEN",
    "--bearer-token-env", "PARENT_TOKEN",
    "--skip-probe-call"
  ]);

  assert.equal(parsed.transport, "stdio");
  assert.equal(parsed.command, "npx");
  assert.deepEqual(parsed.args, ["-y", "github:owner/coffee-mcp"]);
  assert.deepEqual(parsed.env, { STATIC_FLAG: "1" });
  assert.deepEqual(parsed.envFrom, { CHILD_TOKEN: "PARENT_TOKEN" });
  assert.equal(parsed.toolName, "coffee_price_search");
  assert.equal(parsed.tokenEnvName, "COFFEE_MCP_TOKEN");
  assert.equal(parsed.bearerTokenEnv, "PARENT_TOKEN");
  assert.equal(parsed.probeCall, false);
});

test("sets up a generic MCP source after finding the configured tool", async () => {
  let written = "";
  const result = await setupGenericMcpSource(
    {
      configPath: "config.json",
      id: "genericMcp",
      label: "通用 MCP 直连查价源",
      transport: "http",
      endpoint: "http://127.0.0.1:8787/mcp",
      toolName: "coffee_price_search",
      toolResultPath: "snapshot",
      timeoutMs: 120_000,
      dryRun: false,
      probeCall: false,
      sampleMessage: "查公司附近冰美式",
      json: false
    },
    {
      readFile: async () => JSON.stringify(CONFIG),
      writeFile: async (_path, content) => {
        written = content;
      },
      listTools: async () => ["coffee_price_search"]
    }
  );

  assert.equal(result.status, "warn");
  assert.equal(result.changed, true);
  const next = JSON.parse(written) as { externalSources: Array<Record<string, unknown>> };
  assert.equal(next.externalSources.length, 1);
  assert.equal(next.externalSources[0].enabled, true);
  assert.equal(next.externalSources[0].endpoint, "http://127.0.0.1:8787/mcp");
  assert.equal(next.externalSources[0].toolName, "coffee_price_search");
});

test("sets up a stdio MCP source after finding the configured tool", async () => {
  let written = "";
  const result = await setupGenericMcpSource(
    {
      configPath: "config.json",
      id: "stdioMcp",
      label: "本地 stdio MCP",
      transport: "stdio",
      endpoint: "",
      command: "npx",
      args: ["-y", "github:owner/coffee-mcp"],
      env: { STATIC_FLAG: "1" },
      envFrom: { CHILD_TOKEN: "PARENT_TOKEN" },
      bearerTokenEnv: "PARENT_TOKEN",
      tokenEnvName: "COFFEE_MCP_TOKEN",
      toolName: "coffee_price_search",
      toolResultPath: "snapshot",
      timeoutMs: 120_000,
      dryRun: false,
      probeCall: false,
      sampleMessage: "查公司附近冰美式",
      json: false
    },
    {
      readFile: async () => JSON.stringify(CONFIG),
      writeFile: async (_path, content) => {
        written = content;
      },
      listTools: async () => ["coffee_price_search"]
    }
  );

  assert.equal(result.status, "warn");
  assert.equal(result.changed, true);
  const next = JSON.parse(written) as { externalSources: Array<Record<string, unknown>> };
  const source = next.externalSources.find((entry) => entry.id === "stdioMcp");
  assert.ok(source);
  assert.equal(source.transport, "stdio");
  assert.equal(source.command, "npx");
  assert.deepEqual(source.args, ["-y", "github:owner/coffee-mcp"]);
  assert.deepEqual(source.env, { STATIC_FLAG: "1" });
  assert.deepEqual(source.envFrom, { CHILD_TOKEN: "PARENT_TOKEN" });
  assert.equal(source.tokenEnvName, "COFFEE_MCP_TOKEN");
  assert.equal(source.endpoint, undefined);
  assert.match(formatGenericMcpSetupResult(result), /stdioMcp -> npx -y github:owner\/coffee-mcp/);
});

test("does not write config when the MCP tool is missing", async () => {
  let wrote = false;
  const result = await setupGenericMcpSource(
    {
      configPath: "config.json",
      id: "genericMcp",
      label: "通用 MCP 直连查价源",
      transport: "http",
      endpoint: "http://127.0.0.1:8787/mcp",
      toolName: "coffee_price_search",
      timeoutMs: 120_000,
      dryRun: false,
      probeCall: false,
      sampleMessage: "查公司附近冰美式",
      json: false
    },
    {
      readFile: async () => JSON.stringify(CONFIG),
      writeFile: async () => {
        wrote = true;
      },
      listTools: async () => ["other_tool"]
    }
  );

  assert.equal(result.status, "fail");
  assert.equal(result.changed, false);
  assert.equal(wrote, false);
});

test("probe-call verifies that the MCP source returns comparable offers", async () => {
  const result = await setupGenericMcpSource(
    {
      configPath: "config.json",
      id: "genericMcp",
      label: "通用 MCP 直连查价源",
      transport: "http",
      endpoint: "http://127.0.0.1:8787/mcp",
      toolName: "coffee_price_search",
      timeoutMs: 120_000,
      dryRun: true,
      probeCall: true,
      sampleMessage: "查公司附近冰美式",
      json: false
    },
    {
      readFile: async () => JSON.stringify(CONFIG),
      writeFile: async () => {
        throw new Error("dry-run should not write");
      },
      listTools: async () => ["coffee_price_search"],
      probeSource: async (_source, _config: CoffeePriceConfig): Promise<OfferCandidate[]> => [
        {
          source: "genericMcp",
          brand: "瑞幸",
          storeName: "瑞幸 MCP店",
          drinkName: "冰美式",
          normalizedDrink: "americano",
          size: "中杯",
          fulfillment: "pickup",
          itemPrice: 9.9,
          quantity: 1,
          totalPrice: 9.9
        }
      ]
    }
  );

  assert.equal(result.status, "pass");
  assert.equal(result.changed, true);
  assert.equal(result.dryRun, true);
  assert.match(formatGenericMcpSetupResult(result), /将写入: config\.json/);
  assert.match(result.checks.find((check) => check.id === "probe-call")?.message ?? "", /1 个可比报价/);
});

test("package exposes generic MCP setup script", async () => {
  const pkg = await import("../package.json", { with: { type: "json" } });
  assert.match(pkg.default.scripts["mcp:setup"], /generic-mcp-setup-cli\.ts/);
});
