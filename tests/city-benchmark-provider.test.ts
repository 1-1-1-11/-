import assert from "node:assert/strict";
import test from "node:test";

import { CityBenchmarkProvider } from "../src/providers/city-benchmark-provider.js";
import type { AddressConfig, CoffeePriceConfig, CoffeeQuery } from "../src/types.js";

const config: CoffeePriceConfig = {
  defaultAddressAlias: "公司",
  addresses: [],
  browserProfilePath: ".runtime/browser-profile",
  brands: [
    { name: "星巴克", enabled: true },
    { name: "瑞幸", enabled: true },
    { name: "库迪", enabled: true }
  ],
  sources: {
    cityBenchmark: true,
    meituan: false,
    eleme: false,
    brandOfficial: false
  },
  externalSources: []
};

const query: CoffeeQuery = {
  rawText: "查公司附近冰美式",
  addressAlias: "公司",
  drink: "冰美式",
  normalizedDrink: "americano",
  temperature: "冰",
  size: null,
  quantity: 1,
  fulfillment: "both"
};

test("returns mainstream brand pickup benchmark prices for a tier-one city", async () => {
  const provider = new CityBenchmarkProvider();
  const address: AddressConfig = {
    alias: "公司",
    label: "公司",
    query: "深圳南山区科技园"
  };

  const offers = await provider.search({ query, config, address });

  assert.deepEqual(
    offers.map((offer) => [offer.brand, offer.itemPrice, offer.storeName, offer.etaText]),
    [
      ["星巴克", 32, "深圳参考价（非实时）", "仅作横向参考"],
      ["瑞幸", 20, "深圳参考价（非实时）", "仅作横向参考"],
      ["库迪", 18, "深圳参考价（非实时）", "仅作横向参考"]
    ]
  );
});

test("applies lower benchmark multiplier outside tier-one cities", async () => {
  const provider = new CityBenchmarkProvider();
  const address: AddressConfig = {
    alias: "家",
    label: "家",
    query: "成都高新区"
  };

  const offers = await provider.search({ query, config, address });

  assert.equal(offers.find((offer) => offer.brand === "库迪")?.itemPrice, 16.6);
  assert.match(offers[0].distanceText ?? "", /二线参考/);
});

test("returns no benchmark when the drink is unsupported", async () => {
  const provider = new CityBenchmarkProvider();
  const address: AddressConfig = {
    alias: "公司",
    label: "公司",
    query: "深圳南山区科技园"
  };

  const offers = await provider.search({
    query: { ...query, normalizedDrink: "flat_white", drink: "澳白" },
    config,
    address
  });

  assert.deepEqual(offers, []);
});
