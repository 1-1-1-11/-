import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseConfigSetUrlCliArgs,
  setBrowserSourceEntryUrl
} from "../src/config-set-url.js";
import type { CoffeePriceConfig } from "../src/types.js";

const config: CoffeePriceConfig = {
  defaultAddressAlias: "company",
  addresses: [{ alias: "company", label: "Company", query: "Shenzhen Nanshan" }],
  browserProfilePath: ".runtime/browser-profile",
  brands: [{ name: "Luckin", enabled: true }],
  sources: { meituan: true, eleme: false, brandOfficial: false },
  browserSources: {
    meituan: {
      source: "meituan",
      entryUrl: "https://example.com/meituan/search",
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

test("sets a browser source URL without replacing existing selectors", () => {
  const result = setBrowserSourceEntryUrl(
    config,
    "meituan",
    "https://meituan.example.invalid/coffee"
  );

  assert.equal(result.config.browserSources?.meituan?.entryUrl, "https://meituan.example.invalid/coffee");
  assert.equal(result.config.browserSources?.meituan?.selectors.offerRows, ".existing-offer");
  assert.equal(result.config.sources.meituan, true);
  assert.equal(result.addedSource, false);
});

test("sets a browser source URL by scaffolding and enabling a missing channel", () => {
  const result = setBrowserSourceEntryUrl(
    config,
    "eleme",
    "https://eleme.example.invalid/coffee"
  );

  assert.equal(result.config.sources.eleme, true);
  assert.equal(result.config.browserSources?.eleme?.source, "eleme");
  assert.equal(result.config.browserSources?.eleme?.entryUrl, "https://eleme.example.invalid/coffee");
  assert.equal(result.config.browserSources?.eleme?.selectors.fields.itemPrice, "[data-item-price]");
  assert.equal(result.addedSource, true);
});

test("rejects non-http browser source URLs", () => {
  assert.throws(
    () => setBrowserSourceEntryUrl(config, "meituan", "javascript:alert(1)"),
    /http\/https/
  );
});

test("parses config set-url CLI options", () => {
  const parsed = parseConfigSetUrlCliArgs([
    "--config",
    "config/local.json",
    "--source",
    "meituan",
    "--url",
    "https://example.com/page",
    "--write"
  ]);

  assert.equal(parsed.configPath, "config/local.json");
  assert.equal(parsed.source, "meituan");
  assert.equal(parsed.url, "https://example.com/page");
  assert.equal(parsed.write, true);
});

test("package exposes config set-url script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["config:set-url"], /config-set-url\.ts/);
});
