import assert from "node:assert/strict";
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

function config(): CoffeePriceConfig {
  return {
    defaultAddressAlias: "公司",
    addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
    browserProfilePath: "D:/profiles/coffee",
    brands: [{ name: "瑞幸", enabled: true }],
    sources: { priceBook: false, meituan: false, eleme: false, brandOfficial: false }
  };
}
