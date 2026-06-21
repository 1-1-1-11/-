import assert from "node:assert/strict";
import test from "node:test";

import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

import plugin from "../src/openclaw-plugin.js";

test("declares the coffee_price_search OpenClaw tool", () => {
  const metadata = getToolPluginMetadata(plugin);

  assert.equal(metadata?.id, "coffee-price");
  assert.equal(metadata?.name, "Coffee Price Search");
  assert.ok(metadata?.tools.some((tool) => tool.name === "coffee_price_search"));
});

test("forbids order placement offers in the OpenClaw tool contract", () => {
  const metadata = getToolPluginMetadata(plugin);
  const tool = metadata?.tools.find((entry) => entry.name === "coffee_price_search");

  assert.match(tool?.description ?? "", /never place an order/i);
  assert.match(tool?.description ?? "", /never offer to place an order/i);
  assert.match(tool?.description ?? "", /never ask whether the user wants you to place an order/i);
});

test("requires safety boundary sections to survive model formatting", () => {
  const metadata = getToolPluginMetadata(plugin);
  const tool = metadata?.tools.find((entry) => entry.name === "coffee_price_search");

  assert.match(tool?.description ?? "", /需要处理/);
  assert.match(tool?.description ?? "", /未打开购买页/);
  assert.match(tool?.description ?? "", /must keep/i);
});
