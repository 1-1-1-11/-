import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  scaffoldBrowserSources,
  parseConfigScaffoldCliArgs
} from "../src/config-scaffold.js";
import type { CoffeePriceConfig } from "../src/types.js";

const config: CoffeePriceConfig = {
  defaultAddressAlias: "company",
  addresses: [{ alias: "company", label: "Company", query: "Shenzhen Nanshan" }],
  browserProfilePath: ".runtime/browser-profile",
  brands: [{ name: "Luckin", enabled: true }],
  sources: { meituan: true, eleme: true, brandOfficial: true },
  browserSources: {
    meituan: {
      source: "meituan",
      entryUrl: "https://meituan.example.invalid/search?q={{drink}}",
      selectors: {
        offerRows: ".existing-offer",
        fields: {
          brand: ".brand",
          storeName: ".store",
          drinkName: ".drink",
          fulfillment: ".fulfillment",
          itemPrice: ".price"
        }
      }
    }
  }
};

test("scaffolds missing browserSources for enabled channels without replacing existing sources", () => {
  const result = scaffoldBrowserSources(config);

  assert.deepEqual(result.addedSources, ["eleme", "brandOfficial"]);
  assert.equal(result.config.browserSources?.meituan?.selectors.offerRows, ".existing-offer");
  assert.equal(result.config.browserSources?.eleme?.source, "eleme");
  assert.equal(result.config.browserSources?.brandOfficial?.source, "brandOfficial");
  assert.match(result.config.browserSources?.eleme?.entryUrl ?? "", /example\.com/);
  assert.equal(result.config.browserSources?.eleme?.selectors.fields.itemPrice, "[data-item-price]");
  assert.ok(result.config.browserSources?.eleme?.selectors.statusTextPatterns?.loginRequired?.includes("登录"));
  assert.ok(result.config.browserSources?.eleme?.selectors.statusTextPatterns?.unavailable?.includes("网络好像不太给力"));
});

test("skips disabled channels when scaffolding browserSources", () => {
  const result = scaffoldBrowserSources({
    ...config,
    sources: { meituan: true, eleme: false, brandOfficial: false }
  });

  assert.deepEqual(result.addedSources, []);
  assert.equal(result.config.browserSources?.eleme, undefined);
});

test("parses config scaffold CLI options", () => {
  const parsed = parseConfigScaffoldCliArgs([
    "--config",
    "config/local.json",
    "--write"
  ]);

  assert.equal(parsed.configPath, "config/local.json");
  assert.equal(parsed.write, true);
});

test("package exposes config scaffold script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["config:scaffold"], /config-scaffold\.ts/);
});
