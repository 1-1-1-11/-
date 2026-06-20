import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ExternalCommandProvider } from "../src/providers/external-command-provider.js";
import { parseCoffeeCommand } from "../src/query-parser.js";
import type { CoffeePriceConfig } from "../src/types.js";

test("external command provider reads a platform snapshot from stdout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-external-"));
  const scriptPath = join(dir, "source.mjs");
  await writeFile(
    scriptPath,
    [
      "let body = '';",
      "for await (const chunk of process.stdin) body += chunk;",
      "const request = JSON.parse(body);",
      "console.log(JSON.stringify({",
      "  source: 'external-test',",
      "  offers: [{",
      "    brand: '瑞幸',",
      "    storeName: request.address.label,",
      "    drinkName: '冰美式',",
      "    normalizedDrink: 'americano',",
      "    size: '中杯',",
      "    fulfillment: 'pickup',",
      "    itemPrice: 12.9",
      "  }]",
      "}));"
    ].join("\n"),
    "utf8"
  );

  const provider = new ExternalCommandProvider({
    id: "external-test",
    command: process.execPath,
    args: [scriptPath],
    timeoutMs: 10_000
  });
  const result = await provider.search({
    query: parseCoffeeCommand("查公司附近冰美式"),
    config: config(),
    address: { alias: "公司", label: "公司", query: "深圳南山区科技园" }
  });

  assert.ok(Array.isArray(result));
  assert.equal(result[0]?.source, "external-test");
  assert.equal(result[0]?.storeName, "公司");
});

test("external HTTP provider posts request and reads a platform snapshot", async () => {
  const requests: Array<{ body: string; authorization?: string }> = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readRequestBody(request);
    requests.push({
      body,
      authorization: request.headers.authorization
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: {
          snapshot: {
            source: "orderwise-http",
            offers: [
              {
                brand: "瑞幸",
                storeName: "云手机美团店",
                drinkName: "冰美式",
                normalizedDrink: "americano",
                size: "中杯",
                fulfillment: "delivery",
                itemPrice: 12.9,
                deliveryFee: 2,
                packagingFee: 1,
                discounts: [{ label: "平台券", amount: 4 }]
              }
            ]
          }
        }
      })
    );
  });
  const url = await listen(server);
  const previousToken = process.env.COFFEE_HTTP_TOKEN;
  process.env.COFFEE_HTTP_TOKEN = "secret-token";
  try {
    const provider = new ExternalCommandProvider({
      id: "orderwise-http",
      label: "云手机外卖比价",
      type: "http",
      url,
      bearerTokenEnv: "COFFEE_HTTP_TOKEN",
      timeoutMs: 10_000
    });
    const result = await provider.search({
      query: parseCoffeeCommand("查公司附近冰美式"),
      config: config(),
      address: { alias: "公司", label: "公司", query: "深圳南山区科技园" }
    });

    assert.ok(Array.isArray(result));
    assert.equal(result[0]?.source, "orderwise-http");
    assert.equal(result[0]?.storeName, "云手机美团店");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.authorization, "Bearer secret-token");
    assert.equal(JSON.parse(requests[0]!.body).address.alias, "公司");
  } finally {
    if (previousToken === undefined) {
      delete process.env.COFFEE_HTTP_TOKEN;
    } else {
      process.env.COFFEE_HTTP_TOKEN = previousToken;
    }
    await close(server);
  }
});

test("external HTTP provider reports non-2xx responses without inventing prices", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(503, { "content-type": "text/plain" });
    response.end("phone agent unavailable");
  });
  const url = await listen(server);
  try {
    const provider = new ExternalCommandProvider({
      id: "orderwise-http",
      type: "http",
      url,
      timeoutMs: 10_000
    });
    const result = await provider.search({
      query: parseCoffeeCommand("查公司附近冰美式"),
      config: config(),
      address: { alias: "公司", label: "公司", query: "深圳南山区科技园" }
    });

    assert.ok(!Array.isArray(result));
    assert.equal(result.status, "unavailable");
    assert.match(result.message, /HTTP 503/);
  } finally {
    await close(server);
  }
});

function config(): CoffeePriceConfig {
  return {
    defaultAddressAlias: "公司",
    addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
    browserProfilePath: "D:/profiles/coffee",
    brands: [{ name: "瑞幸", enabled: true }],
    sources: { priceBook: false, meituan: false, eleme: false, brandOfficial: false }
  };
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.once("error", reject);
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolve(`http://127.0.0.1:${address.port}/search`);
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
