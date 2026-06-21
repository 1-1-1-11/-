import assert from "node:assert/strict";
import test from "node:test";

import { formatWechatReply } from "../src/formatter.js";
import type { SearchResult } from "../src/types.js";

test("formats delivery and pickup top lists for WeChat", () => {
  const reply = formatWechatReply({
    query: {
      rawText: "查附近冰美式",
      addressAlias: null,
      drink: "冰美式",
      normalizedDrink: "americano",
      temperature: "冰",
      size: null,
      quantity: 1,
      fulfillment: "both"
    },
    resolvedAddress: { alias: "公司", label: "公司", query: "深圳南山区科技园" },
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
        deliveryFee: 2,
        packagingFee: 1,
        discounts: [{ label: "平台券", amount: 3 }],
        totalPrice: 9.9,
        distanceText: "600m",
        etaText: "28分钟",
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
        distanceText: "500m",
        purchaseUrl: "https://example.com/pickup"
      }
    ],
    warnings: [],
    generatedAt: new Date("2026-06-20T10:00:00.000Z")
  } satisfies SearchResult);

  assert.match(reply, /外卖到手价 Top 1/);
  assert.match(reply, /自取价 Top 1/);
  assert.match(reply, /库迪 科技园店/);
  assert.match(reply, /￥9\.90/);
  assert.match(reply, /来源: 美团/);
  assert.match(reply, /来源: 品牌官方/);
  assert.match(reply, /购买页: https:\/\/example.com\/pickup/);
});

test("formats warnings and empty result without pretending a price exists", () => {
  const reply = formatWechatReply({
    query: {
      rawText: "查附近冰美式",
      addressAlias: null,
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
    warnings: ["美团登录态失效，需要重新登录。"],
    generatedAt: new Date("2026-06-20T10:00:00.000Z")
  } satisfies SearchResult);

  assert.match(reply, /当前无法完成真实查价/);
  assert.match(reply, /不会编造价格/);
  assert.match(reply, /美团登录态失效/);
});

test("labels reference source URLs as reference pages instead of purchase pages", () => {
  const reply = formatWechatReply({
    query: {
      rawText: "查附近冰美式",
      addressAlias: null,
      drink: "冰美式",
      normalizedDrink: "americano",
      temperature: "冰",
      size: null,
      quantity: 1,
      fulfillment: "both"
    },
    resolvedAddress: { alias: "公司", label: "公司", query: "深圳南山区科技园" },
    delivery: [],
    pickup: [
      {
        source: "priceBook",
        brand: "库迪",
        storeName: "库迪 参考价",
        drinkName: "冰美式",
        normalizedDrink: "americano",
        size: "中杯",
        fulfillment: "pickup",
        itemPrice: 8.9,
        quantity: 1,
        discounts: [],
        totalPrice: 8.9,
        purchaseUrl: "https://www.cotticoffee.com/"
      }
    ],
    warnings: [],
    generatedAt: new Date("2026-06-20T10:00:00.000Z")
  } satisfies SearchResult);

  assert.match(reply, /参考页: https:\/\/www\.cotticoffee\.com\//);
  assert.doesNotMatch(reply, /购买页: https:\/\/www\.cotticoffee\.com\//);
});

test("marks reference-only rankings as non-realtime data near the top", () => {
  const reply = formatWechatReply({
    query: {
      rawText: "查附近冰美式",
      addressAlias: null,
      drink: "冰美式",
      normalizedDrink: "americano",
      temperature: "冰",
      size: null,
      quantity: 1,
      fulfillment: "both"
    },
    resolvedAddress: { alias: "公司", label: "公司", query: "深圳南山区科技园" },
    delivery: [
      {
        source: "priceBook",
        brand: "库迪",
        storeName: "库迪 外卖参考价",
        drinkName: "冰美式",
        normalizedDrink: "americano",
        size: "中杯",
        fulfillment: "delivery",
        itemPrice: 10.9,
        quantity: 1,
        deliveryFee: 2,
        packagingFee: 1,
        discounts: [],
        totalPrice: 13.9
      }
    ],
    pickup: [],
    warnings: [],
    generatedAt: new Date("2026-06-20T10:00:00.000Z")
  } satisfies SearchResult);

  assert.match(reply, /数据状态：当前结果仅来自参考源，不是实时可下单价格。/);
  assert.ok(
    reply.indexOf("数据状态：") < reply.indexOf("外卖到手价 Top 1"),
    "data status should appear before rankings"
  );
});

test("keeps plain no-match wording when providers returned no blocking reason", () => {
  const reply = formatWechatReply({
    query: {
      rawText: "查附近冰美式",
      addressAlias: null,
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
    generatedAt: new Date("2026-06-20T10:00:00.000Z")
  } satisfies SearchResult);

  assert.match(reply, /没有找到可比价格/);
  assert.doesNotMatch(reply, /当前无法完成真实查价/);
});
