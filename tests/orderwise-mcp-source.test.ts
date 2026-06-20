import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildOrderWiseMcpSnapshot,
  parseOrderWiseMcpSourceArgs,
  runOrderWiseMcpSourceCli
} from "../src/orderwise-mcp-source.js";
import {
  parseOrderWiseDoctorArgs,
  runOrderWiseDoctorCli
} from "../src/orderwise-mcp-doctor.js";
import { parseOrderWiseServeArgs } from "../src/orderwise-mcp-serve.js";
import type { AddressConfig, CoffeeQuery } from "../src/types.js";

const query: CoffeeQuery = {
  rawText: "查公司附近冰美式",
  addressAlias: "公司",
  drink: "冰美式",
  normalizedDrink: "americano",
  temperature: "冰",
  size: null,
  quantity: 1,
  fulfillment: "both"
};

const address: AddressConfig = {
  alias: "公司",
  label: "公司",
  query: "深圳南山区科技园",
  longitude: 113.95,
  latitude: 22.54
};

test("parses OrderWise MCP source CLI options and env defaults", () => {
  const parsed = parseOrderWiseMcpSourceArgs(
    [
      "--endpoint",
      "http://127.0.0.1:8703/mcp",
      "--brands",
      "瑞幸,库迪",
      "--apps",
      "美团,淘宝闪购",
      "--max-steps",
      "60",
      "--model-provider",
      "local",
      "--device-mapping",
      "{\"app1\":\"device-a\"}"
    ],
    { ORDERWISE_BRANDS: "星巴克" }
  );

  assert.equal(parsed.endpoint, "http://127.0.0.1:8703/mcp");
  assert.deepEqual(parsed.brands, ["瑞幸", "库迪"]);
  assert.deepEqual(parsed.apps, ["美团", "淘宝闪购"]);
  assert.equal(parsed.maxSteps, 60);
  assert.equal(parsed.modelProvider, "local");
  assert.deepEqual(parsed.deviceMapping, { app1: "device-a" });
});

test("maps OrderWise MCP platforms array into delivery offers", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const snapshot = await buildOrderWiseMcpSnapshot(
    { query, address },
    {
      endpoint: "http://127.0.0.1:8703/mcp",
      brands: ["瑞幸"],
      apps: ["美团", "京东外卖"],
      maxSteps: 80,
      modelProvider: "local",
      deviceMapping: { app1: "mt-device" }
    },
    {
      callTool: async (name, args) => {
        calls.push({ name, args });
        return {
          structuredContent: {
            product_name: "冰 冰美式",
            seller_name: "瑞幸",
            platforms: [
              {
                app: "美团",
                status: "success",
                price: 12.9,
                delivery_fee: 2,
                pack_fee: 1,
                total_fee: 15.9,
                duration: 42
              },
              {
                app: "京东外卖",
                status: "failed",
                error: "未找到商品"
              }
            ],
            summary: { success_count: 1 }
          }
        };
      }
    }
  );

  assert.equal(snapshot.status, undefined);
  assert.equal(snapshot.source, "orderwiseMcp");
  assert.equal(snapshot.offers?.length, 1);
  assert.equal(calls[0].name, "compare_prices");
  assert.deepEqual(calls[0].args, {
    product_name: "冰 冰美式",
    seller_name: "瑞幸",
    apps: ["美团", "京东外卖"],
    max_steps: 80,
    model_provider: "local",
    device_mapping: { app1: "mt-device" }
  });
  assert.equal(snapshot.offers?.[0]?.source, "orderwiseMcp:美团");
  assert.equal(snapshot.offers?.[0]?.brand, "瑞幸");
  assert.equal(snapshot.offers?.[0]?.fulfillment, "delivery");
  assert.equal(snapshot.offers?.[0]?.itemPrice, 12.9);
  assert.equal(snapshot.offers?.[0]?.deliveryFee, 2);
  assert.equal(snapshot.offers?.[0]?.packagingFee, 1);
  assert.equal(snapshot.offers?.[0]?.totalPrice, 15.9);
});

test("maps OrderWise SDK platform_results object into delivery offers", async () => {
  const snapshot = await buildOrderWiseMcpSnapshot(
    { query, address },
    {
      endpoint: "http://127.0.0.1:8703/mcp",
      brands: ["库迪"],
      apps: ["美团"],
      maxSteps: 100
    },
    {
      callTool: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              best_price: { app: "美团", total_fee: 10.8 },
              platform_results: {
                "美团": {
                  price: "8.8",
                  delivery_fee: "1",
                  pack_fee: "1",
                  total_fee: "10.8"
                }
              }
            })
          }
        ]
      })
    }
  );

  assert.equal(snapshot.offers?.length, 1);
  assert.equal(snapshot.offers?.[0]?.brand, "库迪");
  assert.equal(snapshot.offers?.[0]?.source, "orderwiseMcp:美团");
  assert.equal(snapshot.offers?.[0]?.itemPrice, 8.8);
  assert.equal(snapshot.offers?.[0]?.totalPrice, 10.8);
});

test("returns login_required when OrderWise asks for takeover", async () => {
  const snapshot = await buildOrderWiseMcpSnapshot(
    { query, address },
    {
      endpoint: "http://127.0.0.1:8703/mcp",
      brands: ["瑞幸"],
      apps: ["美团"],
      maxSteps: 100
    },
    {
      callTool: async () => ({
        structuredContent: {
          stop_reason: "INFO_ACTION_NEEDS_REPLY",
          session_id: "session-1",
          message: "需要登录美团"
        }
      })
    }
  );

  assert.equal(snapshot.source, "orderwiseMcp");
  assert.equal(snapshot.status, "login_required");
  assert.match(snapshot.message ?? "", /session-1/);
});

test("returns unavailable instead of throwing when OrderWise endpoint is invalid", async () => {
  const snapshot = await buildOrderWiseMcpSnapshot(
    { query, address },
    {
      endpoint: "not-a-url",
      brands: ["瑞幸"],
      apps: ["美团"],
      maxSteps: 100
    }
  );

  assert.equal(snapshot.source, "orderwiseMcp");
  assert.equal(snapshot.status, "unavailable");
  assert.match(snapshot.message ?? "", /OrderWise MCP 调用失败/);
});

test("CLI prints PlatformSnapshot JSON for externalSources", async () => {
  const result = await runOrderWiseMcpSourceCli(["--brands", "瑞幸", "--apps", "美团"], {
    stdin: JSON.stringify({ query, address }),
    callTool: async () => ({
      structuredContent: {
        platforms: [
          {
            app: "美团",
            status: "success",
            price: 9.9,
            delivery_fee: 2,
            pack_fee: 1,
            total_fee: 12.9
          }
        ]
      }
    })
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /"source":"orderwiseMcp"/);
  assert.match(result.text, /"totalPrice":12.9/);
});

test("package exposes OrderWise MCP source script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["orderwise:mcp-source"], /orderwise-mcp-source-cli\.ts/);
});

test("parses OrderWise doctor options and reports ready service", async () => {
  const parsed = parseOrderWiseDoctorArgs([
    "--endpoint",
    "http://127.0.0.1:8703/mcp",
    "--mapping",
    "mapping.json",
    "--json"
  ]);

  assert.equal(parsed.endpoint, "http://127.0.0.1:8703/mcp");
  assert.equal(parsed.mappingPath, "mapping.json");
  assert.equal(parsed.json, true);

  const result = await runOrderWiseDoctorCli(["--json"], {
    env: {
      PHONE_AGENT_BASE_URL: "http://model.example/v1",
      PHONE_AGENT_MODEL: "autoglm-phone"
    },
    listTools: async () => ["compare_prices"],
    readFile: async () => JSON.stringify({ app1: "10.0.0.1:5555", app2: "10.0.0.2:5555" })
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "pass");
  assert.match(result.text, /compare_prices/);
});

test("OrderWise doctor fails on placeholder device mapping", async () => {
  const result = await runOrderWiseDoctorCli([], {
    env: {},
    listTools: async () => ["compare_prices"],
    readFile: async () => JSON.stringify({ app1: "your-cloud-phone-ip:port" })
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.checks.find((check) => check.id === "device-mapping")?.status, "fail");
  assert.equal(result.report.checks.find((check) => check.id === "model")?.status, "warn");
});

test("parses OrderWise serve options and exposes package scripts", async () => {
  const parsed = parseOrderWiseServeArgs([
    "--repo",
    ".runtime/ow",
    "--python",
    ".runtime/ow/.venv/Scripts/python.exe",
    "--adb",
    "D:\\tools\\adb.exe"
  ]);

  assert.equal(parsed.repoPath, ".runtime/ow");
  assert.equal(parsed.pythonPath, ".runtime/ow/.venv/Scripts/python.exe");
  assert.equal(parsed.adbPath, "D:\\tools\\adb.exe");

  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(pkg.scripts["orderwise:doctor"], /orderwise-mcp-doctor-cli\.ts/);
  assert.match(pkg.scripts["orderwise:serve"], /orderwise-mcp-serve-cli\.ts/);
});
