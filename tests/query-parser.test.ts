import assert from "node:assert/strict";
import test from "node:test";

import { parseCoffeeCommand } from "../src/query-parser.js";

test("parses address alias, drink, size, and default one-cup quantity", () => {
  const query = parseCoffeeCommand("查公司附近拿铁 大杯");

  assert.equal(query.addressAlias, "公司");
  assert.equal(query.drink, "拿铁");
  assert.equal(query.normalizedDrink, "latte");
  assert.equal(query.size, "大杯");
  assert.equal(query.quantity, 1);
  assert.equal(query.fulfillment, "both");
});

test("parses default address and Chinese quantity words", () => {
  const query = parseCoffeeCommand("查咖啡 冰美式 两杯");

  assert.equal(query.addressAlias, null);
  assert.equal(query.drink, "冰美式");
  assert.equal(query.normalizedDrink, "americano");
  assert.equal(query.temperature, "冰");
  assert.equal(query.quantity, 2);
});

test("rejects messages that are not coffee price commands", () => {
  assert.throws(
    () => parseCoffeeCommand("今天下午开会"),
    /不是咖啡查价指令/
  );
});
