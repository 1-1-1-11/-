import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildLuckinProxySnapshot,
  parseLuckinProxySourceArgs,
  runLuckinProxySourceCli
} from "../src/luckin-proxy-source.js";
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
  longitude: 113.9474,
  latitude: 22.5405
};

test("parses Luckin proxy source CLI options and env defaults", () => {
  const parsed = parseLuckinProxySourceArgs(
    [
      "--command",
      "node",
      "--args-json",
      "[\"proxy.js\"]",
      "--shop-name",
      "科技园",
      "--timeout-ms",
      "90000"
    ],
    { LUCKIN_MCP_TOKEN: "token-from-env" }
  );

  assert.equal(parsed.command, "node");
  assert.deepEqual(parsed.args, ["proxy.js"]);
  assert.equal(parsed.shopName, "科技园");
  assert.equal(parsed.timeoutMs, 90_000);
  assert.equal(parsed.token, "token-from-env");
});

test("returns login_required when no Luckin proxy token is available", async () => {
  const snapshot = await buildLuckinProxySnapshot(
    { query, address },
    parseLuckinProxySourceArgs([], { LUCKIN_MCP_TOKEN_FILE: "missing", LUCKIN_OFFICIAL_ENV_FILE: "missing.env" }),
    {
      readFile: async () => {
        throw new Error("missing");
      }
    }
  );

  assert.equal(snapshot.source, "luckinProxyMcp");
  assert.equal(snapshot.status, "login_required");
});

test("maps Luckin MCP proxy findShop and quickOrder into a pickup snapshot", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const snapshot = await buildLuckinProxySnapshot(
    { query, address },
    parseLuckinProxySourceArgs(["--shop-name", "科技园"], { LUCKIN_MCP_TOKEN: "token" }),
    {
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === "findShop") {
          return [
            {
              deptId: 100001,
              deptName: "瑞幸 科技园店",
              address: "深圳南山区科技园"
            }
          ];
        }
        return {
          status: "preview",
          draftId: "draft-1",
          productName: "标准美式",
          attrs: "大杯/冰/不另外加糖",
          shopName: "瑞幸 科技园店",
          price: 19.8,
          originalPrice: 58,
          discount: 38.2
        };
      }
    }
  );

  assert.equal(snapshot.status, undefined);
  assert.equal(snapshot.source, "luckinProxyMcp");
  assert.deepEqual(calls, [
    {
      name: "findShop",
      args: { name: "科技园", longitude: 113.9474, latitude: 22.5405 }
    },
    {
      name: "quickOrder",
      args: { query: "冰 冰美式", shopName: "瑞幸 科技园店", amount: 2 }
    }
  ]);
  assert.equal(snapshot.offers?.[0]?.source, "luckinProxyMcp");
  assert.equal(snapshot.offers?.[0]?.brand, "瑞幸");
  assert.equal(snapshot.offers?.[0]?.storeName, "瑞幸 科技园店");
  assert.equal(snapshot.offers?.[0]?.drinkName, "标准美式");
  assert.equal(snapshot.offers?.[0]?.itemPrice, 29);
  assert.equal(snapshot.offers?.[0]?.totalPrice, 19.8);
  assert.deepEqual(snapshot.offers?.[0]?.discounts, [
    { label: "瑞幸 MCP Proxy 预览优惠", amount: 38.2 }
  ]);
});

test("returns no_stock when Luckin proxy returns SKU candidates", async () => {
  const snapshot = await buildLuckinProxySnapshot(
    { query, address },
    parseLuckinProxySourceArgs([], { LUCKIN_MCP_TOKEN: "token" }),
    {
      callTool: async (name) => {
        if (name === "findShop") {
          return [{ deptName: "瑞幸 科技园店" }];
        }
        return {
          status: "candidates",
          message: "没有找到完全匹配口味要求的 SKU",
          candidates: [{ productName: "热美式", attrs: "热" }]
        };
      }
    }
  );

  assert.equal(snapshot.status, "no_stock");
  assert.match(snapshot.message ?? "", /SKU/);
});

test("CLI prints PlatformSnapshot JSON for externalSources", async () => {
  const result = await runLuckinProxySourceCli([], {
    stdin: JSON.stringify({ query, address }),
    env: { LUCKIN_MCP_TOKEN_FILE: "missing", LUCKIN_OFFICIAL_ENV_FILE: "missing.env" },
    readFile: async () => {
      throw new Error("missing");
    }
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /"source":"luckinProxyMcp"/);
  assert.match(result.text, /"status":"login_required"/);
});

test("package exposes Luckin proxy source script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["luckin:proxy-source"], /luckin-proxy-source-cli\.ts/);
});
