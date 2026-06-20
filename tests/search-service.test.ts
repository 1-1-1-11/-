import assert from "node:assert/strict";
import test from "node:test";

import { parseCoffeeCommand } from "../src/query-parser.js";
import { searchCoffeePrices } from "../src/search-service.js";
import type { CoffeePriceConfig, CoffeeSourceProvider, OfferCandidate } from "../src/types.js";

const config: CoffeePriceConfig = {
  defaultAddressAlias: "公司",
  addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
  browserProfilePath: "D:/profiles/coffee",
  brands: [
    { name: "瑞幸", enabled: true },
    { name: "库迪", enabled: true },
    { name: "星巴克", enabled: true }
  ],
  sources: { meituan: true, eleme: true, brandOfficial: true }
};

test("returns top three delivery and pickup offers without mixing drink categories", async () => {
  const candidates: OfferCandidate[] = [
    candidate("瑞幸", "冰美式", "delivery", 9.9),
    candidate("星巴克", "拿铁", "delivery", 8.8),
    candidate("库迪", "冰美式", "delivery", 7.8),
    candidate("星巴克", "冰美式", "delivery", 13.6),
    candidate("Manner", "冰美式", "delivery", 11.1),
    candidate("瑞幸", "冰美式", "pickup", 6.9),
    candidate("库迪", "冰美式", "pickup", 5.9),
    candidate("星巴克", "冰美式", "pickup", 12.5),
    candidate("Manner", "冰美式", "pickup", 10.5)
  ];
  const provider: CoffeeSourceProvider = {
    id: "fixture",
    label: "fixture",
    search: async () => candidates
  };

  const result = await searchCoffeePrices({
    query: parseCoffeeCommand("查公司附近冰美式"),
    config,
    providers: [provider]
  });

  assert.deepEqual(
    result.delivery.map((offer) => offer.brand),
    ["库迪", "瑞幸", "星巴克"]
  );
  assert.deepEqual(
    result.pickup.map((offer) => offer.brand),
    ["库迪", "瑞幸", "星巴克"]
  );
  assert.ok(result.delivery.every((offer) => offer.normalizedDrink === "americano"));
  assert.equal(result.warnings.length, 0);
});

test("reports provider status instead of inventing prices", async () => {
  const provider: CoffeeSourceProvider = {
    id: "meituan",
    label: "美团",
    search: async () => ({
      status: "login_required",
      message: "美团登录态失效，需要重新登录。"
    })
  };

  const result = await searchCoffeePrices({
    query: parseCoffeeCommand("查附近冰美式"),
    config,
    providers: [provider]
  });

  assert.deepEqual(result.delivery, []);
  assert.deepEqual(result.pickup, []);
  assert.match(result.warnings[0] ?? "", /登录态失效/);
});

test("uses requested quantity when ranking provider offers", async () => {
  const provider: CoffeeSourceProvider = {
    id: "fixture",
    label: "fixture",
    search: async () => [candidate("瑞幸", "冰美式", "pickup", 12.9)]
  };

  const result = await searchCoffeePrices({
    query: parseCoffeeCommand("查咖啡 冰美式 两杯"),
    config,
    providers: [provider]
  });

  assert.equal(result.pickup[0]?.quantity, 2);
  assert.equal(result.pickup[0]?.totalPrice, 25.8);
});

function candidate(
  brand: string,
  drinkName: string,
  fulfillment: "delivery" | "pickup",
  total: number
): OfferCandidate {
  return {
    source: "fixture",
    brand,
    storeName: `${brand} 科技园店`,
    drinkName,
    normalizedDrink: drinkName.includes("美式") ? "americano" : "latte",
    size: "中杯",
    fulfillment,
    itemPrice: total,
    quantity: 1,
    deliveryFee: fulfillment === "delivery" ? 0 : undefined,
    packagingFee: fulfillment === "delivery" ? 0 : undefined,
    discounts: [],
    distanceText: "800m",
    etaText: fulfillment === "delivery" ? "30分钟" : undefined,
    purchaseUrl: `https://example.com/${brand}/${fulfillment}`
  };
}
