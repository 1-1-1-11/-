import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PriceBookProvider } from "../src/providers/price-book-provider.js";
import { parseCoffeeCommand } from "../src/query-parser.js";
import type { CoffeePriceConfig } from "../src/types.js";

test("price book provider filters offers by configured address alias", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-pricebook-"));
  const priceBookPath = join(dir, "pricebook.json");
  await writeFile(
    priceBookPath,
    JSON.stringify({
      source: "priceBook",
      offers: [
        {
          addressAliases: ["公司"],
          brand: "瑞幸",
          storeName: "瑞幸 科技园店",
          drinkName: "冰美式",
          normalizedDrink: "americano",
          size: "中杯",
          fulfillment: "pickup",
          itemPrice: 12.9
        },
        {
          addressAliases: ["家"],
          brand: "库迪",
          storeName: "库迪 福田店",
          drinkName: "冰美式",
          normalizedDrink: "americano",
          size: "中杯",
          fulfillment: "pickup",
          itemPrice: 10.9
        }
      ]
    }),
    "utf8"
  );

  const provider = new PriceBookProvider("priceBook", "本地价格库", priceBookPath);
  const result = await provider.search({
    query: parseCoffeeCommand("查公司附近冰美式"),
    config: config(priceBookPath),
    address: { alias: "公司", label: "公司", query: "深圳南山区科技园" }
  });

  assert.ok(Array.isArray(result));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.brand, "瑞幸");
});

function config(priceBookPath: string): CoffeePriceConfig {
  return {
    defaultAddressAlias: "公司",
    addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
    browserProfilePath: "D:/profiles/coffee",
    priceBookPath,
    brands: [{ name: "瑞幸", enabled: true }],
    sources: { priceBook: true, meituan: false, eleme: false, brandOfficial: false }
  };
}
