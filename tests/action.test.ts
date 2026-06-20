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

test("runs from the local price book without opening browser sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-action-pricebook-"));
  const configPath = join(dir, "config.json");
  const priceBookPath = join(dir, "pricebook.json");

  await writeFile(
    configPath,
    JSON.stringify({
      defaultAddressAlias: "公司",
      addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
      browserProfilePath: "D:/profiles/coffee",
      priceBookPath,
      brands: [{ name: "库迪", enabled: true }],
      sources: { priceBook: true, meituan: false, eleme: false, brandOfficial: false }
    }),
    "utf8"
  );
  await writeFile(
    priceBookPath,
    JSON.stringify({
      source: "priceBook",
      offers: [
        {
          addressAliases: ["公司"],
          brand: "库迪",
          storeName: "库迪 科技园店",
          drinkName: "冰美式",
          normalizedDrink: "americano",
          size: "中杯",
          fulfillment: "pickup",
          itemPrice: 10.9,
          discounts: [{ label: "本地券", amount: 1 }],
          purchaseUrl: "https://example.com/cotti"
        }
      ]
    }),
    "utf8"
  );

  const reply = await runCoffeePriceSearch({
    message: "查公司附近冰美式",
    configPath
  });

  assert.match(reply, /自取价 Top 1/);
  assert.match(reply, /库迪 科技园店/);
  assert.match(reply, /￥9\.90/);
});

test("uses city benchmark source as a no-token fallback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-action-benchmark-"));
  const configPath = join(dir, "config.json");

  await writeFile(
    configPath,
    JSON.stringify({
      defaultAddressAlias: "公司",
      addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
      browserProfilePath: "D:/profiles/coffee",
      brands: [
        { name: "星巴克", enabled: true },
        { name: "瑞幸", enabled: true },
        { name: "库迪", enabled: true }
      ],
      sources: {
        priceBook: false,
        cityBenchmark: true,
        meituan: false,
        eleme: false,
        brandOfficial: false
      }
    }),
    "utf8"
  );

  const reply = await runCoffeePriceSearch({
    message: "查公司附近冰美式",
    configPath
  });

  assert.match(reply, /自取价 Top 3/);
  assert.match(reply, /深圳参考价（非实时）/);
  assert.match(reply, /库迪/);
  assert.match(reply, /￥18\.00/);
});
