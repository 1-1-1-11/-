import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEFAULT_BRANDS } from "../src/config.js";
import {
  buildMcdOfficialSnapshot,
  parseMcdOfficialSourceArgs,
  runMcdOfficialSourceCli
} from "../src/mcd-official-source.js";
import type { AddressConfig, CoffeeQuery } from "../src/types.js";

const query: CoffeeQuery = {
  rawText: "查公司附近冰美式",
  addressAlias: "公司",
  drink: "冰美式",
  normalizedDrink: "americano",
  temperature: "冰",
  size: null,
  quantity: 2,
  fulfillment: "both"
};

const address: AddressConfig = {
  alias: "公司",
  label: "公司",
  query: "深圳市南山区科技园",
  longitude: 113.9474,
  latitude: 22.5405
};

test("parses McDonald's official MCP source CLI options and env defaults", () => {
  const parsed = parseMcdOfficialSourceArgs(
    ["--endpoint", "https://mcp.mcd.cn", "--token-file", "mcd.token", "--max-stores", "2"],
    { MCD_TOKEN: "token-from-env" }
  );

  assert.equal(parsed.endpoint, "https://mcp.mcd.cn");
  assert.equal(parsed.token, "token-from-env");
  assert.equal(parsed.tokenPath, "mcd.token");
  assert.equal(parsed.maxStores, 2);
});

test("returns login_required when no McDonald's MCP token is available", async () => {
  const snapshot = await buildMcdOfficialSnapshot(
    { query, address },
    parseMcdOfficialSourceArgs([], { MCD_MCP_TOKEN_FILE: "missing-token" }),
    {
      readFile: async () => {
        throw new Error("missing");
      }
    }
  );

  assert.equal(snapshot.source, "mcdOfficial");
  assert.equal(snapshot.status, "login_required");
  assert.match(snapshot.message ?? "", /麦当劳 MCP token/);
  assert.match(snapshot.message ?? "", /绑定麦当劳 token/);
  assert.match(snapshot.message ?? "", /open\.mcd\.cn\/mcp/);
});

test("maps official McDonald's MCP tools into pickup coffee offers", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const snapshot = await buildMcdOfficialSnapshot(
    { query, address },
    parseMcdOfficialSourceArgs(["--max-stores", "1"], { MCD_MCP_TOKEN: "token" }),
    {
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === "query-nearby-stores") {
          return {
            structuredContent: {
              success: true,
              data: [
                {
                  storeCode: "SZ001",
                  beCode: "BE001",
                  storeName: "麦当劳深圳科技园餐厅",
                  address: "深圳市南山区科技园",
                  distance: "0.6km"
                }
              ]
            }
          };
        }
        if (name === "query-meals") {
          return {
            structuredContent: {
              success: true,
              data: {
                categories: [{ name: "麦咖啡", meals: [{ code: "MCAF-AMERICANO", tags: [] }] }],
                meals: {
                  "MCAF-AMERICANO": {
                    name: "冰美式咖啡",
                    currentPrice: "12"
                  },
                  "MCAF-LATTE": {
                    name: "拿铁咖啡",
                    currentPrice: "15"
                  }
                }
              }
            }
          };
        }
        return {
          structuredContent: {
            success: true,
            data: {
              productOriginalPrice: 2400,
              productPrice: 2400,
              discount: 400,
              price: 2000,
              productList: [
                {
                  productCode: "MCAF-AMERICANO",
                  productName: "冰美式咖啡",
                  quantity: 2,
                  originalSubtotal: 2400,
                  subtotal: 2000
                }
              ],
              takeWayList: [{ takeWayCode: "TAKE001" }]
            }
          }
        };
      }
    }
  );

  assert.equal(snapshot.status, undefined);
  assert.equal(snapshot.source, "mcdOfficial");
  assert.deepEqual(calls, [
    {
      name: "query-nearby-stores",
      args: { searchType: 2, beType: 1, city: "深圳市", keyword: "深圳市南山区科技园" }
    },
    {
      name: "query-meals",
      args: { storeCode: "SZ001", beCode: "BE001", orderType: 1, beType: 1 }
    },
    {
      name: "calculate-price",
      args: {
        storeCode: "SZ001",
        beCode: "BE001",
        orderType: 1,
        beType: 1,
        items: [{ productCode: "MCAF-AMERICANO", quantity: 2 }]
      }
    }
  ]);
  assert.equal(snapshot.offers?.length, 1);
  assert.equal(snapshot.offers?.[0]?.source, "mcdOfficial");
  assert.equal(snapshot.offers?.[0]?.brand, "麦咖啡");
  assert.equal(snapshot.offers?.[0]?.storeName, "麦当劳深圳科技园餐厅");
  assert.equal(snapshot.offers?.[0]?.drinkName, "冰美式咖啡");
  assert.equal(snapshot.offers?.[0]?.fulfillment, "pickup");
  assert.equal(snapshot.offers?.[0]?.itemPrice, 12);
  assert.equal(snapshot.offers?.[0]?.totalPrice, 20);
  assert.deepEqual(snapshot.offers?.[0]?.discounts, [
    { label: "麦当劳官方 MCP 优惠", amount: 4 }
  ]);
});

test("CLI prints McDonald's PlatformSnapshot JSON for externalSources", async () => {
  const result = await runMcdOfficialSourceCli([], {
    stdin: JSON.stringify({ query, address }),
    env: { MCD_MCP_TOKEN_FILE: "missing-token" },
    readFile: async () => {
      throw new Error("missing");
    }
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /"source":"mcdOfficial"/);
  assert.match(result.text, /"status":"login_required"/);
});

test("package exposes McDonald's official source script and brand", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["mcd:official-source"], /mcd-official-source-cli\.ts/);
  assert.ok(DEFAULT_BRANDS.includes("麦咖啡"));
});
