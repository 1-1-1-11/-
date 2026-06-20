import assert from "node:assert/strict";
import test from "node:test";

import {
  openLowestPurchasePage,
  selectLowestPurchasePage
} from "../src/purchase-page-opener.js";
import type { SearchResult } from "../src/types.js";

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
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
    },
    resolvedAddress: { alias: "公司", label: "公司", query: "深圳南山区科技园" },
    delivery: [],
    pickup: [],
    warnings: [],
    generatedAt: new Date("2026-06-20T10:00:00.000Z"),
    ...overrides
  };
}

test("selects the cheapest safe purchase page across delivery and pickup", () => {
  const selected = selectLowestPurchasePage(
    makeResult({
      delivery: [
        {
          source: "meituan",
          brand: "库迪",
          storeName: "库迪 科技园店",
          drinkName: "冰美式",
          normalizedDrink: "americano",
          size: "中杯",
          fulfillment: "delivery",
          itemPrice: 9.9,
          quantity: 1,
          deliveryFee: 1,
          packagingFee: 1,
          discounts: [],
          totalPrice: 11.9,
          purchaseUrl: "https://example.com/delivery"
        }
      ],
      pickup: [
        {
          source: "brandOfficial",
          brand: "瑞幸",
          storeName: "瑞幸 科技园店",
          drinkName: "冰美式",
          normalizedDrink: "americano",
          size: "中杯",
          fulfillment: "pickup",
          itemPrice: 12.9,
          quantity: 1,
          discounts: [{ label: "品牌券", amount: 6 }],
          totalPrice: 6.9,
          purchaseUrl: "https://example.com/pickup"
        }
      ]
    })
  );

  assert.equal(selected?.url, "https://example.com/pickup");
  assert.equal(selected?.offer.brand, "瑞幸");
});

test("skips unsafe purchase URL schemes and opens the next safe candidate", async () => {
  const opened: string[] = [];
  const result = await openLowestPurchasePage(
    makeResult({
      delivery: [
        {
          source: "meituan",
          brand: "库迪",
          storeName: "库迪 科技园店",
          drinkName: "冰美式",
          normalizedDrink: "americano",
          size: "中杯",
          fulfillment: "delivery",
          itemPrice: 5,
          quantity: 1,
          discounts: [],
          totalPrice: 5,
          purchaseUrl: "javascript:alert(1)"
        },
        {
          source: "meituan",
          brand: "Tims",
          storeName: "Tims 科技园店",
          drinkName: "冰美式",
          normalizedDrink: "americano",
          size: "中杯",
          fulfillment: "delivery",
          itemPrice: 8,
          quantity: 1,
          discounts: [],
          totalPrice: 8,
          purchaseUrl: "https://example.com/tims"
        }
      ]
    }),
    {
      open: async (url) => {
        opened.push(url);
      }
    }
  );

  assert.deepEqual(opened, ["https://example.com/tims"]);
  assert.equal(result.status, "opened");
});
