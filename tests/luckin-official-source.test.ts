import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildLuckinOfficialSnapshot,
  parseLuckinOfficialSourceArgs,
  runLuckinOfficialSourceCli,
  type OfficialCliCommandResult
} from "../src/luckin-official-source.js";
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

test("parses official Luckin source CLI options and defaults", () => {
  const parsed = parseLuckinOfficialSourceArgs(
    [
      "--cli-path",
      "D:\\tools\\luckin.exe",
      "--timeout-ms",
      "90000",
      "--max-shops",
      "2",
      "--token-file",
      "token.txt"
    ],
    {},
    "win32",
    "D:\\work"
  );

  assert.equal(parsed.cliPath, "D:\\tools\\luckin.exe");
  assert.equal(parsed.timeoutMs, 90_000);
  assert.equal(parsed.maxShops, 2);
  assert.equal(parsed.tokenPath, "token.txt");
});

test("returns login_required when no official Luckin token is available", async () => {
  const snapshot = await buildLuckinOfficialSnapshot(
    { query, address },
    parseLuckinOfficialSourceArgs([], { LUCKIN_MCP_TOKEN_FILE: "missing", LUCKIN_OFFICIAL_ENV_FILE: "missing.env" }),
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
  assert.match(snapshot.message ?? "", /official-login/);
});

test("maps official Luckin CLI auth errors to login_required", async () => {
  const snapshot = await buildLuckinOfficialSnapshot(
    { query, address },
    parseLuckinOfficialSourceArgs(["--cli-path", "luckin"], { LUCKIN_MCP_ORDER_TOKEN: "token" }),
    {
      runCommand: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "Error: Token 已过期或无效，HTTP 401，请重新获取 Token"
      })
    }
  );

  assert.equal(snapshot.status, "login_required");
  assert.match(snapshot.message ?? "", /微信私聊/);
  assert.match(snapshot.message ?? "", /绑定瑞幸 token/);
  assert.match(snapshot.message ?? "", /重新运行 npm run luckin:official-login/);
});

test("maps official Luckin CLI JSON output into pickup offers", async () => {
  const calls: Array<{ command: string; args: string[]; token?: string }> = [];
  const snapshot = await buildLuckinOfficialSnapshot(
    { query, address },
    parseLuckinOfficialSourceArgs(["--cli-path", "luckin", "--max-shops", "1"], { LUCKIN_MCP_ORDER_TOKEN: "token" }),
    {
      runCommand: async (command, args, options) => {
        calls.push({ command, args, token: options.env.LUCKIN_MCP_ORDER_TOKEN });
        return resultFor(args, {
          store: JSON.stringify({
            data: [
              {
                deptId: 123,
                deptName: "瑞幸 科技园店",
                distance: 0.8
              }
            ]
          }),
          product: JSON.stringify({
            productList: [
              {
                productId: 456,
                productName: "冰美式",
                skuCode: "SKU-456",
                initialPrice: 29,
                estimatePrice: 9.9
              }
            ]
          }),
          preview: JSON.stringify({
            totalInitialPrice: 58,
            privilegeMoney: 38.2,
            discountPrice: 19.8,
            aboutTime: 12,
            pay_order_url: "https://lk.example/order/preview"
          })
        });
      }
    }
  );

  assert.equal(snapshot.status, undefined);
  assert.equal(snapshot.source, "luckinMcp");
  assert.equal(snapshot.offers?.length, 1);
  assert.deepEqual(calls.map((call) => call.args), [
    ["store", "22.5405", "113.9474"],
    ["product", "123", "冰", "冰美式"],
    ["order", "preview", "123", "--product", "456:SKU-456:2"]
  ]);
  assert.equal(calls[0].token, "token");
  assert.equal(snapshot.offers?.[0]?.brand, "瑞幸");
  assert.equal(snapshot.offers?.[0]?.storeName, "瑞幸 科技园店");
  assert.equal(snapshot.offers?.[0]?.fulfillment, "pickup");
  assert.equal(snapshot.offers?.[0]?.itemPrice, 29);
  assert.equal(snapshot.offers?.[0]?.totalPrice, 19.8);
  assert.equal(snapshot.offers?.[0]?.purchaseUrl, "https://lk.example/order/preview");
  assert.deepEqual(snapshot.offers?.[0]?.discounts, [
    { label: "瑞幸官方 CLI 预览优惠", amount: 38.2 }
  ]);
});

test("maps official Luckin CLI pipe tables into pickup offers", async () => {
  const snapshot = await buildLuckinOfficialSnapshot(
    { query: { ...query, quantity: 1 }, address },
    parseLuckinOfficialSourceArgs(["--cli-path", "luckin"], { LUCKIN_MCP_ORDER_TOKEN: "token" }),
    {
      runCommand: async (_command, args) => resultFor(args, {
        store: [
          "| deptId | deptName | distance |",
          "| --- | --- | --- |",
          "| 100 | 瑞幸 海岸城店 | 1.2km |"
        ].join("\n"),
        product: [
          "| productId | productName | skuCode | initialPrice | estimatePrice |",
          "| --- | --- | --- | --- | --- |",
          "| 200 | 冰美式 | SKU-200 | ¥19 | ¥9.9 |"
        ].join("\n"),
        preview: [
          "| totalInitialPrice | privilegeMoney | discountPrice | aboutTime | payOrderUrl |",
          "| --- | --- | --- | --- | --- |",
          "| ¥19 | ¥9.1 | ¥9.9 | 10分钟 | https://lk.example/table |"
        ].join("\n")
      })
    }
  );

  assert.equal(snapshot.status, undefined);
  assert.equal(snapshot.offers?.[0]?.storeName, "瑞幸 海岸城店");
  assert.equal(snapshot.offers?.[0]?.itemPrice, 19);
  assert.equal(snapshot.offers?.[0]?.totalPrice, 9.9);
  assert.equal(snapshot.offers?.[0]?.etaText, "10分钟");
  assert.equal(snapshot.offers?.[0]?.purchaseUrl, "https://lk.example/table");
});

test("CLI prints PlatformSnapshot JSON for externalSources", async () => {
  const result = await runLuckinOfficialSourceCli([], {
    stdin: JSON.stringify({ query, address }),
    env: { LUCKIN_MCP_TOKEN_FILE: "missing", LUCKIN_OFFICIAL_ENV_FILE: "missing.env" },
    readFile: async () => {
      throw new Error("missing");
    }
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /"source":"luckinMcp"/);
  assert.match(result.text, /"status":"login_required"/);
});

test("package exposes official Luckin source script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["luckin:official-source"], /luckin-official-source-cli\.ts/);
});

function resultFor(args: string[], outputs: { store: string; product: string; preview: string }): OfficialCliCommandResult {
  const stdout = args[0] === "store"
    ? outputs.store
    : args[0] === "product"
      ? outputs.product
      : outputs.preview;
  return {
    exitCode: 0,
    stdout,
    stderr: ""
  };
}
