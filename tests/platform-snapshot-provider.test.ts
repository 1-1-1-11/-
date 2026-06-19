import assert from "node:assert/strict";
import test from "node:test";

import { parsePlatformSnapshot } from "../src/providers/platform-snapshot-provider.js";

test("turns login or captcha snapshots into provider status", () => {
  const login = parsePlatformSnapshot({
    source: "meituan",
    status: "login_required",
    message: "美团登录态失效，需要重新登录。"
  });
  const captcha = parsePlatformSnapshot({
    source: "eleme",
    status: "captcha_required",
    message: "饿了么出现验证码，需要人工处理。"
  });

  assert.deepEqual(login, {
    status: "login_required",
    message: "美团登录态失效，需要重新登录。"
  });
  assert.deepEqual(captcha, {
    status: "captcha_required",
    message: "饿了么出现验证码，需要人工处理。"
  });
});

test("drops unavailable and no-stock rows while preserving comparable offers", () => {
  const parsed = parsePlatformSnapshot({
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
        distanceText: "700m",
        etaText: "25分钟",
        purchaseUrl: "https://example.com/r"
      },
      {
        brand: "星巴克",
        storeName: "星巴克 科技园店",
        drinkName: "冰美式",
        normalizedDrink: "americano",
        size: "中杯",
        fulfillment: "delivery",
        itemPrice: 19,
        unavailableReason: "门店无货"
      }
    ]
  });

  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.source, "meituan");
  assert.equal(parsed[0]?.brand, "瑞幸");
  assert.equal(parsed[0]?.quantity, 1);
  assert.equal(parsed[0]?.discounts?.[0]?.amount, 4);
});
