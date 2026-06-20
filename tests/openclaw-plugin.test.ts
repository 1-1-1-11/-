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
