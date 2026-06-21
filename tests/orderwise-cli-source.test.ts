import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildOrderWiseCliSnapshot,
  parseOrderWiseCliSourceArgs,
  runOrderWiseCliSourceCli
} from "../src/orderwise-cli-source.js";
import type { AddressConfig, CoffeeQuery } from "../src/types.js";

const query: CoffeeQuery = {
  rawText: "查公司附近冰美式",
  addressAlias: "公司",
  drink: "冰美式",
  normalizedDrink: "americano",
  temperature: "冰",
  size: "中杯",
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

test("parses OrderWise CLI source options and env defaults", () => {
  const parsed = parseOrderWiseCliSourceArgs(
    [
      "--repo",
      ".runtime/orderwise-agent",
      "--python",
      ".runtime/orderwise-agent/.venv/Scripts/python.exe",
      "--adb",
      "D:\\tools\\adb.exe",
      "--mapping",
      "mapping.json",
      "--brands",
      "瑞幸,库迪",
      "--apps",
      "美团",
      "--max-steps",
      "60",
      "--device-mapping",
      "{\"app1\":\"device-a\"}"
    ],
    { ORDERWISE_BRANDS: "星巴克" }
  );

  assert.equal(parsed.repoPath, ".runtime/orderwise-agent");
  assert.equal(parsed.pythonPath, ".runtime/orderwise-agent/.venv/Scripts/python.exe");
  assert.equal(parsed.adbPath, "D:\\tools\\adb.exe");
  assert.equal(parsed.mappingPath, "mapping.json");
  assert.deepEqual(parsed.brands, ["瑞幸", "库迪"]);
  assert.deepEqual(parsed.apps, ["美团"]);
  assert.equal(parsed.maxSteps, 60);
  assert.deepEqual(parsed.deviceMapping, { app1: "device-a" });
});

test("OrderWise CLI source maps Python JSON into delivery offers", async () => {
  const calls: Array<{ productName: string; sellerName: string; apps: string[]; deviceMapping: Record<string, string> }> = [];
  const snapshot = await buildOrderWiseCliSnapshot(
    { query, address },
    {
      repoPath: ".runtime/orderwise-agent",
      pythonPath: "python",
      mappingPath: "mapping.json",
      brands: ["瑞幸"],
      apps: ["美团"],
      maxSteps: 80,
      deviceMapping: { app1: "device-a" }
    },
    {
      runPython: async (_options, payload) => {
        calls.push({
          productName: payload.productName,
          sellerName: payload.sellerName,
          apps: payload.apps,
          deviceMapping: payload.deviceMapping
        });
        return {
          exitCode: 0,
          stderr: "",
          stdout: [
            "some OrderWise log",
            "__ORDERWISE_CLI_JSON__",
            JSON.stringify({
              best_price: { app: "美团", total_fee: 15.9 },
              platform_results: {
                "美团": {
                  price: 12.9,
                  delivery_fee: 2,
                  pack_fee: 1,
                  total_fee: 15.9
                }
              }
            })
          ].join("\n")
        };
      }
    }
  );

  assert.equal(snapshot.source, "orderwiseCli");
  assert.equal(snapshot.status, undefined);
  assert.deepEqual(calls[0], {
    productName: "冰 冰美式 中杯",
    sellerName: "瑞幸",
    apps: ["美团"],
    deviceMapping: { app1: "device-a" }
  });
  assert.equal(snapshot.offers?.[0]?.source, "orderwiseCli:美团");
  assert.equal(snapshot.offers?.[0]?.brand, "瑞幸");
  assert.equal(snapshot.offers?.[0]?.fulfillment, "delivery");
  assert.equal(snapshot.offers?.[0]?.itemPrice, 12.9);
  assert.equal(snapshot.offers?.[0]?.deliveryFee, 2);
  assert.equal(snapshot.offers?.[0]?.packagingFee, 1);
  assert.equal(snapshot.offers?.[0]?.totalPrice, 15.9);
});

test("OrderWise CLI source returns unavailable for placeholder mappings", async () => {
  const snapshot = await buildOrderWiseCliSnapshot(
    { query, address },
    {
      repoPath: ".runtime/orderwise-agent",
      pythonPath: "python",
      mappingPath: "mapping.json",
      brands: ["瑞幸"],
      apps: ["美团"],
      maxSteps: 80
    },
    {
      readFile: async () => JSON.stringify({ app1: "your-cloud-phone-ip:port" }),
      runPython: async () => {
        throw new Error("must not call Python without a usable device mapping");
      }
    }
  );

  assert.equal(snapshot.source, "orderwiseCli");
  assert.equal(snapshot.status, "unavailable");
  assert.match(snapshot.message ?? "", /设备映射/);
});

test("CLI prints PlatformSnapshot JSON for externalSources", async () => {
  const result = await runOrderWiseCliSourceCli(["--brands", "瑞幸", "--apps", "美团"], {
    stdin: JSON.stringify({ query, address }),
    env: {},
    readFile: async () => JSON.stringify({ app1: "device-a" }),
    runPython: async () => ({
      exitCode: 0,
      stderr: "",
      stdout: `${JSON.stringify({
        platform_results: {
          "美团": {
            price: 9.9,
            delivery_fee: 2,
            pack_fee: 1,
            total_fee: 12.9
          }
        }
      })}\n`
    })
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /"source":"orderwiseCli"/);
  assert.match(result.text, /"totalPrice":12.9/);
});

test("package exposes OrderWise CLI source script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["orderwise:cli-source"], /orderwise-cli-source-cli\.ts/);
  assert.match(pkg.scripts["orderwise:cli-source"], /^node --import tsx /);
});
