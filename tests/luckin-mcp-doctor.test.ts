import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  formatLuckinDoctorReport,
  parseLuckinDoctorArgs,
  runLuckinDoctorCli
} from "../src/luckin-mcp-doctor.js";
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
  priceBookPath: "config/pricebook.json",
  brands: [],
  sources: {
    priceBook: true,
    meituan: false,
    eleme: false,
    brandOfficial: false
  },
  externalSources: [
    {
      id: "luckinMcp",
      label: "瑞幸官方 MCP",
      enabled: true,
      command: "node",
      args: ["--import", "tsx", "src/luckin-mcp-source-cli.ts"]
    }
  ]
};

test("parses Luckin doctor CLI options", () => {
  const parsed = parseLuckinDoctorArgs(["--config", "config/local.json", "--json"]);

  assert.equal(parsed.configPath, "config/local.json");
  assert.equal(parsed.json, true);
});

test("Luckin doctor fails clearly when token is missing", async () => {
  const result = await runLuckinDoctorCli(["--config", "config.json"], {
    env: { LUCKIN_MCP_TOKEN_FILE: "missing-token" },
    readFile: async (path) => {
      if (path === "config.json") {
        return JSON.stringify(config);
      }
      throw new Error("missing");
    },
    readConfig: async () => config
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, "fail");
  assert.equal(result.report.checks.find((check) => check.id === "token")?.status, "fail");
  assert.match(formatLuckinDoctorReport(result.report), /LUCKIN_MCP_TOKEN/);
});

test("Luckin doctor passes with file token, coordinates, enabled source, and https endpoint", async () => {
  const result = await runLuckinDoctorCli(["--config", "config.json", "--json"], {
    env: { LUCKIN_MCP_TOKEN_FILE: "token-file" },
    readFile: async (path) => {
      if (path === "config.json") {
        return JSON.stringify(config);
      }
      if (path === "token-file") {
        return "token";
      }
      throw new Error("missing");
    },
    readConfig: async () => config
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "pass");
  assert.match(result.text, /"status": "pass"/);
});

test("Luckin doctor warns when source exists but is disabled", async () => {
  const disabledConfig: CoffeePriceConfig = {
    ...config,
    externalSources: config.externalSources?.map((source) => ({ ...source, enabled: false }))
  };
  const result = await runLuckinDoctorCli(["--config", "config.json"], {
    env: { LUCKIN_MCP_TOKEN: "token" },
    readFile: async () => JSON.stringify(disabledConfig),
    readConfig: async () => disabledConfig
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "warn");
  assert.equal(result.report.checks.find((check) => check.id === "external-source")?.status, "warn");
});

test("Luckin doctor fails when default address lacks coordinates", async () => {
  const missingCoordinatesConfig: CoffeePriceConfig = {
    ...config,
    addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }]
  };
  const result = await runLuckinDoctorCli(["--config", "config.json"], {
    env: { LUCKIN_MCP_TOKEN: "token" },
    readFile: async () => JSON.stringify(missingCoordinatesConfig),
    readConfig: async () => missingCoordinatesConfig
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.checks.find((check) => check.id === "coordinates")?.status, "fail");
});

test("package exposes Luckin doctor script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["luckin:doctor"], /luckin-mcp-doctor-cli\.ts/);
});
