import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCoffeePriceSearch } from "../src/action.js";

test("runs a complete coffee search from config and source snapshots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-action-"));
  const configPath = join(dir, "config.json");
  const snapshotPath = join(dir, "meituan.json");

  await writeFile(
    configPath,
    JSON.stringify({
      defaultAddressAlias: "公司",
      addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
      browserProfilePath: "D:/profiles/coffee",
      brands: [{ name: "瑞幸", enabled: true }],
      sources: { meituan: true, eleme: false, brandOfficial: false }
    }),
    "utf8"
  );
  await writeFile(
    snapshotPath,
    JSON.stringify({
      source: "meituan",
      offers: [
        {
          brand: "瑞幸",
          storeName: "瑞幸 科技园店",
          drinkName: "冰美式",
          normalizedDrink: "americano",
          size: "中杯",
          fulfillment: "delivery",
          itemPrice: 12.9,
          deliveryFee: 2,
          packagingFee: 1,
          discounts: [{ label: "平台券", amount: 4 }],
          purchaseUrl: "https://example.com/order"
        }
      ]
    }),
    "utf8"
  );

  const reply = await runCoffeePriceSearch({
    message: "查公司附近冰美式",
    configPath,
    snapshotPaths: { meituan: snapshotPath }
  });

  assert.match(reply, /外卖到手价 Top 1/);
  assert.match(reply, /瑞幸 科技园店/);
  assert.match(reply, /购买页: https:\/\/example.com\/order/);
});

test("opens the lowest purchase page when configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-action-open-"));
  const configPath = join(dir, "config.json");
  const snapshotPath = join(dir, "meituan.json");
  const opened: string[] = [];

  await writeFile(
    configPath,
    JSON.stringify({
      defaultAddressAlias: "公司",
      addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
      browserProfilePath: "D:/profiles/coffee",
      openLowestPurchasePage: true,
      brands: [{ name: "瑞幸", enabled: true }],
      sources: { meituan: true, eleme: false, brandOfficial: false }
    }),
    "utf8"
  );
  await writeFile(
    snapshotPath,
    JSON.stringify({
      source: "meituan",
      offers: [
        {
          brand: "瑞幸",
          storeName: "瑞幸 科技园店",
          drinkName: "冰美式",
          normalizedDrink: "americano",
          size: "中杯",
          fulfillment: "delivery",
          itemPrice: 12.9,
          deliveryFee: 2,
          packagingFee: 1,
          discounts: [{ label: "平台券", amount: 4 }],
          purchaseUrl: "https://example.com/order"
        }
      ]
    }),
    "utf8"
  );

  const reply = await runCoffeePriceSearch({
    message: "查公司附近冰美式",
    configPath,
    snapshotPaths: { meituan: snapshotPath },
    purchasePageOpener: {
      open: async (url) => {
        opened.push(url);
      }
    }
  });

  assert.deepEqual(opened, ["https://example.com/order"]);
  assert.match(reply, /已打开最低价购买页/);
});
