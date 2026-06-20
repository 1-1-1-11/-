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
import {
  configureOrderWise,
  loadOrderWiseEnvFile,
  parseOrderWiseConfigureArgs
} from "../src/orderwise-configure.js";
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
    "--env-file",
    "orderwise.env",
    "--json"
  ]);

  assert.equal(parsed.endpoint, "http://127.0.0.1:8703/mcp");
  assert.equal(parsed.mappingPath, "mapping.json");
  assert.equal(parsed.envPath, "orderwise.env");
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
    "D:\\tools\\adb.exe",
    "--env-file",
    ".runtime/ow/.env.local"
  ]);

  assert.equal(parsed.repoPath, ".runtime/ow");
  assert.equal(parsed.pythonPath, ".runtime/ow/.venv/Scripts/python.exe");
  assert.equal(parsed.adbPath, "D:\\tools\\adb.exe");
  assert.equal(parsed.envPath, ".runtime/ow/.env.local");

  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(pkg.scripts["orderwise:doctor"], /orderwise-mcp-doctor-cli\.ts/);
  assert.match(pkg.scripts["orderwise:serve"], /orderwise-mcp-serve-cli\.ts/);
  assert.match(pkg.scripts["orderwise:configure"], /orderwise-configure-cli\.ts/);
});

test("configures OrderWise mapping, local env, and enabled source", async () => {
  const parsed = parseOrderWiseConfigureArgs([
    "--meituan",
    "10.0.0.1:5555",
    "--jd",
    "10.0.0.2:5555",
    "--phone-agent-base-url",
    "http://model.local/v1",
    "--phone-agent-model",
    "autoglm-phone-9b",
    "--phone-agent-api-key-env",
    "PHONE_KEY",
    "--phone-agent-max-steps",
    "80",
    "--enable-source"
  ]);

  assert.deepEqual(parsed.mapping, { app1: "10.0.0.1:5555", app2: "10.0.0.2:5555" });
  assert.equal(parsed.phoneAgentBaseUrl, "http://model.local/v1");
  assert.equal(parsed.phoneAgentModel, "autoglm-phone-9b");
  assert.equal(parsed.phoneAgentApiKeyEnv, "PHONE_KEY");
  assert.equal(parsed.phoneAgentMaxSteps, 80);
  assert.equal(parsed.enableSource, true);

  const writes = new Map<string, string>();
  const result = await configureOrderWise(
    {
      ...parsed,
      mappingPath: "mapping.json",
      envPath: "orderwise.env",
      configPath: "config.json"
    },
    {
      readFile: async (path) => {
        if (writes.has(path)) {
          return writes.get(path)!;
        }
        if (path === "mapping.json") {
          return JSON.stringify({ app1: "your-cloud-phone-ip:port", app3: "10.0.0.3:5555" });
        }
        if (path === "orderwise.env") {
          return "PHONE_AGENT_MODEL=\"old-model\"\n";
        }
        if (path === "config.json") {
          return JSON.stringify({
            defaultAddressAlias: "公司",
            addresses: [],
            browserProfilePath: ".runtime/browser-profile",
            brands: [],
            sources: {},
            externalSources: [{ id: "orderwiseMcp", enabled: false }]
          });
        }
        throw new Error(path);
      },
      writeFile: async (path, content) => {
        writes.set(path, content);
      },
      mkdir: async () => undefined
    }
  );

  assert.equal(result.mappingChanged, true);
  assert.equal(result.envChanged, true);
  assert.equal(result.sourceChanged, true);
  assert.deepEqual(JSON.parse(writes.get("mapping.json") ?? "{}"), {
    app3: "10.0.0.3:5555",
    app1: "10.0.0.1:5555",
    app2: "10.0.0.2:5555"
  });
  assert.match(writes.get("orderwise.env") ?? "", /PHONE_AGENT_BASE_URL="http:\/\/model\.local\/v1"/);
  assert.match(writes.get("orderwise.env") ?? "", /PHONE_AGENT_API_KEY_ENV="PHONE_KEY"/);
  const nextConfig = JSON.parse(writes.get("config.json") ?? "{}");
  assert.equal(nextConfig.externalSources[0].enabled, true);
});

test("OrderWise configure accepts official self-hosted model env names", async () => {
  const parsed = parseOrderWiseConfigureArgs([
    "--meituan",
    "10.0.0.1:5555",
    "--orderwise-model-url",
    "http://model.local/v1",
    "--orderwise-model-name",
    "autoglm-phone-9b",
    "--phone-agent-api-key-env",
    "PHONE_KEY"
  ]);

  assert.equal(parsed.orderwiseModelUrl, "http://model.local/v1");
  assert.equal(parsed.orderwiseModelName, "autoglm-phone-9b");

  const writes = new Map<string, string>();
  await configureOrderWise(
    {
      ...parsed,
      mappingPath: "mapping.json",
      envPath: "orderwise.env",
      configPath: "config.json"
    },
    {
      readFile: async (path) => {
        if (path === "mapping.json") {
          return "{}";
        }
        if (path === "orderwise.env") {
          return "";
        }
        return JSON.stringify({ externalSources: [] });
      },
      writeFile: async (path, content) => {
        writes.set(path, content);
      },
      mkdir: async () => undefined
    }
  );

  const envFile = writes.get("orderwise.env") ?? "";
  assert.match(envFile, /PHONE_AGENT_BASE_URL="http:\/\/model\.local\/v1"/);
  assert.match(envFile, /PHONE_AGENT_MODEL="autoglm-phone-9b"/);
  assert.match(envFile, /ORDERWISE_MODEL_URL="http:\/\/model\.local\/v1"/);
  assert.match(envFile, /ORDERWISE_MODEL_NAME="autoglm-phone-9b"/);
});

test("OrderWise configure dry-run is a no-op without new values", async () => {
  const result = await configureOrderWise(
    {
      ...parseOrderWiseConfigureArgs(["--dry-run"]),
      mappingPath: "mapping.json",
      envPath: "orderwise.env",
      configPath: "config.json"
    },
    {
      readFile: async (path) => {
        if (path === "mapping.json") {
          return "{\r\n  \"app1\": \"your-cloud-phone-ip:port\"\r\n}\r\n";
        }
        if (path === "orderwise.env") {
          throw new Error("missing");
        }
        return "{}";
      },
      writeFile: async () => {
        throw new Error("dry-run must not write files");
      },
      mkdir: async () => {
        throw new Error("dry-run must not create directories");
      }
    }
  );

  assert.equal(result.mappingChanged, false);
  assert.equal(result.envChanged, false);
  assert.equal(result.sourceChanged, false);
});

test("OrderWise local env file is loaded by doctor helpers", async () => {
  const env = await loadOrderWiseEnvFile(
    "orderwise.env",
    { PHONE_KEY: "secret-from-shell" },
    async () => [
      "PHONE_AGENT_BASE_URL=\"http://model.local/v1\"",
      "PHONE_AGENT_MODEL=\"autoglm-phone-9b\"",
      "PHONE_AGENT_API_KEY_ENV=\"PHONE_KEY\""
    ].join("\n")
  );

  assert.equal(env.PHONE_AGENT_BASE_URL, "http://model.local/v1");
  assert.equal(env.PHONE_AGENT_MODEL, "autoglm-phone-9b");
  assert.equal(env.PHONE_AGENT_API_KEY, "secret-from-shell");

  const result = await runOrderWiseDoctorCli(["--env-file", "orderwise.env"], {
    env: { PHONE_KEY: "secret-from-shell" },
    listTools: async () => ["compare_prices"],
    readFile: async (path) => {
      if (path === "orderwise.env") {
        return [
          "PHONE_AGENT_BASE_URL=\"http://model.local/v1\"",
          "PHONE_AGENT_MODEL=\"autoglm-phone-9b\"",
          "PHONE_AGENT_API_KEY_ENV=\"PHONE_KEY\""
        ].join("\n");
      }
      return JSON.stringify({ app1: "10.0.0.1:5555" });
    }
  });

  assert.equal(result.report.checks.find((check) => check.id === "model")?.status, "pass");
});

test("OrderWise local env maps official model names to backend env", async () => {
  const env = await loadOrderWiseEnvFile(
    "orderwise.env",
    {},
    async () => [
      "ORDERWISE_MODEL_URL=\"http://model.local/v1\"",
      "ORDERWISE_MODEL_NAME=\"autoglm-phone-9b\""
    ].join("\n")
  );

  assert.equal(env.ORDERWISE_MODEL_URL, "http://model.local/v1");
  assert.equal(env.ORDERWISE_MODEL_NAME, "autoglm-phone-9b");
  assert.equal(env.PHONE_AGENT_BASE_URL, "http://model.local/v1");
  assert.equal(env.PHONE_AGENT_MODEL, "autoglm-phone-9b");

  const result = await runOrderWiseDoctorCli(["--env-file", "orderwise.env"], {
    listTools: async () => ["compare_prices"],
    readFile: async (path) => {
      if (path === "orderwise.env") {
        return [
          "ORDERWISE_MODEL_URL=\"http://model.local/v1\"",
          "ORDERWISE_MODEL_NAME=\"autoglm-phone-9b\""
        ].join("\n");
      }
      return JSON.stringify({ app1: "10.0.0.1:5555" });
    }
  });

  assert.equal(result.report.checks.find((check) => check.id === "model")?.status, "pass");
});
