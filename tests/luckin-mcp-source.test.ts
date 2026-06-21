import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildLuckinMcpSnapshot,
  parseLuckinMcpSourceArgs,
  resolveLuckinToken,
  runLuckinMcpSourceCli
} from "../src/luckin-mcp-source.js";
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
  query: "深圳南山区科技园",
  longitude: 113.95,
  latitude: 22.54
};

test("parses Luckin MCP source CLI options and env defaults", () => {
  const parsed = parseLuckinMcpSourceArgs(
    ["--endpoint", "https://example.com/mcp", "--longitude", "1.2", "--latitude", "3.4", "--max-shops", "2"],
    { LUCKIN_MCP_TOKEN: "token-from-env" }
  );

  assert.equal(parsed.endpoint, "https://example.com/mcp");
  assert.equal(parsed.token, "token-from-env");
  assert.equal(parsed.longitude, 1.2);
  assert.equal(parsed.latitude, 3.4);
  assert.equal(parsed.maxShops, 2);
});

test("parses aivo-compatible Luckin token env alias", () => {
  const parsed = parseLuckinMcpSourceArgs([], { LUCKIN_MCP_ORDER_TOKEN: "order-token" });

  assert.equal(parsed.token, "order-token");
  assert.equal(parsed.tokenEnvName, "LUCKIN_MCP_ORDER_TOKEN");
});

test("resolves official Luckin CLI env token file", async () => {
  const parsed = parseLuckinMcpSourceArgs([], {
    LUCKIN_MCP_TOKEN_FILE: "missing-token",
    LUCKIN_OFFICIAL_ENV_FILE: "official.env"
  });
  const resolved = await resolveLuckinToken(parsed, {
    readFile: async (path) => {
      if (path === "official.env") {
        return "LUCKIN_MCP_ORDER_TOKEN=\"Bearer official-token-1234567890\"\n";
      }
      throw new Error("missing");
    }
  });

  assert.equal(resolved?.token, "official-token-1234567890");
  assert.equal(resolved?.source, "official.env");
});

test("returns login_required when no Luckin token is available", async () => {
  const snapshot = await buildLuckinMcpSnapshot(
    { query, address },
    {
      endpoint: "https://example.com/mcp",
      tokenPath: "missing-token",
      maxShops: 5
    },
    {
      readFile: async () => {
        throw new Error("missing");
      }
    }
  );

  assert.equal(snapshot.source, "luckinMcp");
  assert.equal(snapshot.status, "login_required");
  assert.match(snapshot.message ?? "", /微信私聊/);
  assert.match(snapshot.message ?? "", /绑定瑞幸 token/);
  assert.match(snapshot.message ?? "", /luckin:official-login/);
});

test("maps official Luckin MCP shop, product, and preview tools into a pickup snapshot", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const snapshot = await buildLuckinMcpSnapshot(
    { query, address },
    {
      endpoint: "https://example.com/mcp",
      token: "token",
      maxShops: 1
    },
    {
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === "queryShopList") {
          return {
            structuredContent: {
              data: [
                {
                  deptId: 123,
                  deptName: "瑞幸 科技园店",
                  distance: 0.8
                }
              ]
            }
          };
        }
        if (name === "searchProductForMcp") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  productList: [
                    {
                      productId: 456,
                      productName: "冰美式",
                      skuCode: "SP-456",
                      initialPrice: 29,
                      estimatePrice: 9.9
                    }
                  ]
                })
              }
            ]
          };
        }
        return {
          structuredContent: {
            totalInitialPrice: 58,
            privilegeMoney: 38.2,
            discountPrice: 19.8,
            aboutTime: 12
          }
        };
      }
    }
  );

  assert.equal(snapshot.status, undefined);
  assert.equal(snapshot.offers?.length, 1);
  assert.deepEqual(calls.map((call) => call.name), [
    "queryShopList",
    "searchProductForMcp",
    "previewOrder"
  ]);
  assert.equal(calls[1].args.query, "冰 冰美式");
  assert.equal(snapshot.offers?.[0]?.brand, "瑞幸");
  assert.equal(snapshot.offers?.[0]?.fulfillment, "pickup");
  assert.equal(snapshot.offers?.[0]?.itemPrice, 29);
  assert.deepEqual(snapshot.offers?.[0]?.discounts, [
    { label: "瑞幸官方 MCP 预览优惠", amount: 38.2 }
  ]);
});

test("CLI prints PlatformSnapshot JSON for externalSources", async () => {
  const result = await runLuckinMcpSourceCli([], {
    stdin: JSON.stringify({ query, address }),
    env: {},
    readFile: async () => {
      throw new Error("missing");
    }
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /"source":"luckinMcp"/);
  assert.match(result.text, /"status":"login_required"/);
});

test("package exposes Luckin MCP source script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["luckin:mcp-source"], /luckin-mcp-source-cli\.ts/);
});
