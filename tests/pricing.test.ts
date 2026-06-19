import assert from "node:assert/strict";
import test from "node:test";

import { calculateOfferTotal } from "../src/pricing.js";

test("calculates delivery total with quantity, delivery, packaging, and discounts", () => {
  const total = calculateOfferTotal({
    fulfillment: "delivery",
    itemPrice: 16,
    quantity: 2,
    deliveryFee: 5,
    packagingFee: 2,
    discounts: [
      { label: "平台券", amount: 4 },
      { label: "店铺满减", amount: 3 }
    ]
  });

  assert.equal(total, 32);
});

test("calculates pickup total without delivery or packaging fees", () => {
  const total = calculateOfferTotal({
    fulfillment: "pickup",
    itemPrice: 13,
    quantity: 1,
    discounts: [{ label: "品牌券", amount: 5 }]
  });

  assert.equal(total, 8);
});

test("never returns a negative total", () => {
  const total = calculateOfferTotal({
    fulfillment: "pickup",
    itemPrice: 6,
    quantity: 1,
    discounts: [{ label: "大额券", amount: 20 }]
  });

  assert.equal(total, 0);
});
