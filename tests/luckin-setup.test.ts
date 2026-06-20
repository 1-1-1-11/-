import assert from "node:assert/strict";
import test from "node:test";

import { parseLuckinSetupArgs, runLuckinSetupCli, setupLuckinMcp } from "../src/luckin-setup.js";
import type { CoffeePriceConfig } from "../src/types.js";

const config: CoffeePriceConfig = {
  defaultAddressAlias: "公司",
  addresses: [
    {
      alias: "公司",
      label: "公司",
      query: "深圳南山区科技园",
      longitude: 113.9474,
      latitude: 22.5405
    }
  ],
  browserProfilePath: ".runtime/browser-profile",
  brands: [{ name: "瑞幸", enabled: true }],
  sources: {
    priceBook: true,
    cityBenchmark: true,
    meituan: false,
    eleme: false,
    brandOfficial: false
  },
  externalSources: []
};

test("parses setup CLI options", () => {
  const parsed = parseLuckinSetupArgs([
    "--config",
    "config/local.json",
    "--token",
    "Authorization: Bearer abc1234567890123",
    "--token-file",
    "token.txt",
    "--skip-refresh",
    "--require-live",
    "--json"
  ]);

  assert.equal(parsed.configPath, "config/local.json");
  assert.equal(parsed.tokenText, "Authorization: Bearer abc1234567890123");
  assert.equal(parsed.tokenPath, "token.txt");
  assert.equal(parsed.refresh, false);
  assert.equal(parsed.requireLive, true);
  assert.equal(parsed.json, true);
});

test("setup exits successfully in degraded mode when fallback sources are enabled", async () => {
  const result = await setupLuckinMcp(
    {
      configPath: "config.json",
      tokenPath: "token.txt",
      refresh: true,
      json: false,
      requireLive: false
    },
    {
      readConfig: async () => config,
      runLuckinDoctor: async () => ({
        status: "fail",
        checks: [
          { id: "config", label: "配置文件", status: "pass", message: "ok" },
          { id: "token", label: "瑞幸 token", status: "fail", message: "missing" },
          { id: "coordinates", label: "地址经纬度", status: "pass", message: "ok" },
          { id: "external-source", label: "externalSources.luckinMcp", status: "warn", message: "disabled" },
          { id: "endpoint", label: "MCP endpoint", status: "pass", message: "ok" }
        ]
      }),
      refreshPriceBook: async () => {
        throw new Error("refresh should not run");
      }
    }
  );

  assert.equal(result.status, "degraded");
  assert.equal(result.importedToken, false);
  assert.deepEqual(result.fallbackSources, ["本地价格库", "城市参考价（非实时）"]);
  assert.match(result.text, /降级可用/);
});

test("setup imports token, checks readiness, and refreshes price book", async () => {
  const calls: string[] = [];
  const result = await setupLuckinMcp(
    {
      configPath: "config.json",
      tokenText: "Bearer abc1234567890123",
      tokenPath: "token.txt",
      refresh: true,
      json: false,
      requireLive: true
    },
    {
      readConfig: async () => config,
      importLuckinToken: async (options) => {
        calls.push(`import:${options.configPath}:${options.tokenPath}:${options.enable}`);
        return { tokenPath: options.tokenPath, enabled: true, text: "已保存瑞幸 token：token.txt" };
      },
      runLuckinDoctor: async () => ({
        status: "pass",
        checks: [
          { id: "config", label: "配置文件", status: "pass", message: "ok" },
          { id: "token", label: "瑞幸 token", status: "pass", message: "ok" },
          { id: "coordinates", label: "地址经纬度", status: "pass", message: "ok" },
          { id: "external-source", label: "externalSources.luckinMcp", status: "pass", message: "ok" },
          { id: "endpoint", label: "MCP endpoint", status: "pass", message: "ok" }
        ]
      }),
      refreshPriceBook: async (options) => {
        calls.push(`refresh:${options.configPath}`);
        return {
          outputPath: "config/pricebook.json",
          updatedAt: "2026-06-21T03:00:00.000Z",
          refreshedOffers: 1,
          retainedOffers: 2,
          warnings: []
        };
      }
    }
  );

  assert.equal(result.status, "ready");
  assert.equal(result.importedToken, true);
  assert.deepEqual(calls, ["import:config.json:token.txt:true", "refresh:config.json"]);
  assert.match(result.text, /价格库刷新成功/);
});

test("setup CLI returns non-zero when live mode is required but checks fail", async () => {
  const result = await runLuckinSetupCli(["--require-live"], {
    readConfig: async () => config,
    runLuckinDoctor: async () => ({
      status: "fail",
      checks: [{ id: "token", label: "瑞幸 token", status: "fail", message: "missing" }]
    })
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.result.status, "blocked");
  assert.match(result.text, /阻塞原因/);
});
