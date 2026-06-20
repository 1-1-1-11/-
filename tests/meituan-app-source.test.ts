import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { Response } from "undici";

import {
  buildMeituanAppSnapshot,
  parseMeituanAppSourceArgs,
  runMeituanAppSourceCli
} from "../src/meituan-app-source.js";
import type { CoffeeQuery } from "../src/types.js";

test("parses Meituan app source CLI options", () => {
  const parsed = parseMeituanAppSourceArgs([
    "--base-url",
    "http://127.0.0.1:18080",
    "--brands",
    "瑞幸,库迪",
    "--timeout-ms",
    "30000"
  ]);

  assert.equal(parsed.baseUrl, "http://127.0.0.1:18080");
  assert.deepEqual(parsed.brands, ["瑞幸", "库迪"]);
  assert.equal(parsed.timeoutMs, 30_000);
});

test("parses Meituan app source options after npm script terminator", () => {
  const parsed = parseMeituanAppSourceArgs([
    "--",
    "--base-url",
    "http://127.0.0.1:9",
    "--brands",
    "ASCIIBRAND",
    "--timeout-ms",
    "1"
  ]);

  assert.equal(parsed.baseUrl, "http://127.0.0.1:9");
  assert.deepEqual(parsed.brands, ["ASCIIBRAND"]);
  assert.equal(parsed.timeoutMs, 1);
});

test("maps meituan-cli HTTP flow into a delivery snapshot", async () => {
  const calls: Array<{ method: string; path: string; query: string; body?: string }> = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readRequestBody(request) : undefined;
    calls.push({ method: request.method ?? "GET", path: url.pathname, query: url.search, body });
    response.writeHead(200, { "content-type": "application/json" });

    if (url.pathname === "/search") {
      response.end(JSON.stringify({ ok: true, count: 1, restaurants: [{ name: "瑞幸 科技园店", distance: "800m" }] }));
      return;
    }
    if (url.pathname === "/cart") {
      response.end(JSON.stringify({ ok: true, items: [{ name: "冰美式", price: 12.9, quantity: 1 }], total: 12.9, count: 1 }));
      return;
    }
    if (url.pathname === "/checkout") {
      response.end(JSON.stringify({
        ok: true,
        address: "深圳南山区科技园",
        total: 15.9,
        item_total: 12.9,
        delivery_fee: 2,
        packaging_fee: 1,
        delivery_time: "约30分钟"
      }));
      return;
    }
    response.end(JSON.stringify({ ok: true }));
  });
  const baseUrl = await listen(server);
  try {
    const snapshot = await buildMeituanAppSnapshot(
      request(),
      { baseUrl, brands: ["瑞幸"], timeoutMs: 10_000 }
    );

    assert.equal(snapshot.source, "meituanApp");
    assert.equal(snapshot.offers?.[0]?.brand, "瑞幸");
    assert.equal(snapshot.offers?.[0]?.storeName, "瑞幸 科技园店");
    assert.equal(snapshot.offers?.[0]?.fulfillment, "delivery");
    assert.equal(snapshot.offers?.[0]?.itemPrice, 12.9);
    assert.equal(snapshot.offers?.[0]?.deliveryFee, 2);
    assert.equal(snapshot.offers?.[0]?.packagingFee, 1);
    assert.equal(snapshot.offers?.[0]?.totalPrice, 15.9);
    assert.deepEqual(
      calls.map((call) => `${call.method} ${call.path}`),
      [
        "GET /launch",
        "GET /search",
        "GET /open",
        "GET /tap",
        "GET /type",
        "POST /add_to_cart",
        "GET /cart",
        "GET /checkout"
      ]
    );
    assert.match(calls.find((call) => call.path === "/search")?.query ?? "", /keyword=/);
    assert.match(calls.find((call) => call.path === "/add_to_cart")?.body ?? "", /冰美式/);
  } finally {
    await close(server);
  }
});

test("returns provider status when every meituan-cli quote fails", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "未达到起送金额，还差 ¥7" }));
  });
  const baseUrl = await listen(server);
  try {
    const snapshot = await buildMeituanAppSnapshot(
      request(),
      { baseUrl, brands: ["瑞幸"], timeoutMs: 10_000 }
    );

    assert.equal(snapshot.status, "unavailable");
    assert.match(snapshot.message ?? "", /未达到起送金额/);
  } finally {
    await close(server);
  }
});

test("CLI prints a PlatformSnapshot JSON for externalSources", async () => {
  const result = await runMeituanAppSourceCli(["--brands", "瑞幸"], {
    stdin: JSON.stringify(request()),
    fetch: async () => new Response(JSON.stringify({ ok: false, error: "service unavailable" }), { status: 200 })
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /"source":"meituanApp"/);
});

test("package exposes Meituan app source script", async () => {
  const pkg = await import("../package.json", { with: { type: "json" } });
  assert.match(pkg.default.scripts["meituan:app-source"], /meituan-app-source-cli\.ts/);
  assert.match(pkg.default.scripts["meituan:app-source"], /^node --import tsx /);
});

function request() {
  return {
    query: {
      rawText: "查公司附近冰美式",
      addressAlias: "公司",
      drink: "冰美式",
      normalizedDrink: "americano",
      temperature: "冰",
      size: null,
      quantity: 1,
      fulfillment: "both"
    } satisfies CoffeeQuery,
    address: { alias: "公司", label: "公司", query: "深圳南山区科技园" }
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
      resolve(`http://127.0.0.1:${address.port}`);
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
