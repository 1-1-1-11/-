import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_BRANDS, readConfig } from "../src/config.js";

test("reads local config and preserves default brand coverage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-price-"));
  const configPath = join(dir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      defaultAddressAlias: "公司",
      addresses: [{ alias: "公司", label: "Office", query: "深圳南山区科技园" }],
      browserProfilePath: "D:/profiles/coffee",
      openLowestPurchasePage: true,
      sources: { meituan: true, eleme: true, brandOfficial: true },
      browserSources: {
        meituan: {
          source: "meituan",
          entryUrl: "https://example.com?q={{drink}}",
          selectors: {
            offerRows: "[data-offer]",
            fields: {
              brand: "[data-brand]",
              storeName: "[data-store]",
              drinkName: "[data-drink]",
              fulfillment: "[data-fulfillment]",
              itemPrice: "[data-item-price]"
            }
          }
        }
      }
    }),
    "utf8"
  );

  const config = await readConfig(configPath);

  assert.equal(config.defaultAddressAlias, "公司");
  assert.equal(config.addresses[0]?.query, "深圳南山区科技园");
  assert.equal(config.browserProfilePath, "D:/profiles/coffee");
  assert.equal(config.openLowestPurchasePage, true);
  assert.equal(config.priceBookPath, join(dir, "config", "pricebook.json"));
  assert.equal(config.sources.priceBook, false);
  assert.equal(config.sources.meituan, true);
  assert.deepEqual(config.externalSources, []);
  assert.equal(config.browserSources?.meituan?.entryUrl, "https://example.com?q={{drink}}");
  assert.ok(DEFAULT_BRANDS.includes("瑞幸"));
  assert.ok(config.brands.some((brand) => brand.name === "星巴克" && brand.enabled));
});

test("resolves relative runtime paths from the config root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-price-paths-"));
  const configDir = join(dir, "config");
  await mkdir(configDir, { recursive: true });
  const configPath = join(configDir, "coffee-price.config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      addresses: [],
      browserProfilePath: ".runtime/browser-profile",
      priceBookPath: "config/pricebook.json",
      priceBookRefresh: {
        outputPath: "config/pricebook.json",
        queries: [{ message: "\u67e5\u516c\u53f8\u9644\u8fd1\u51b0\u7f8e\u5f0f" }]
      },
      externalSources: [
        {
          id: "feed",
          command: "node",
          args: ["scripts/feed.mjs"]
        }
      ]
    }),
    "utf8"
  );

  const config = await readConfig(configPath);

  assert.equal(config.browserProfilePath, join(dir, ".runtime", "browser-profile"));
  assert.equal(config.priceBookPath, join(dir, "config", "pricebook.json"));
  assert.equal(config.priceBookRefresh?.outputPath, join(dir, "config", "pricebook.json"));
  assert.equal(config.externalSources?.[0]?.cwd, dir);
});

test("can preserve disabled external sources for readiness diagnostics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-price-disabled-sources-"));
  const configPath = join(dir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      addresses: [],
      browserProfilePath: ".runtime/browser-profile",
      externalSources: [
        { id: "enabled", command: "node" },
        { id: "disabled", enabled: false, command: "node" }
      ]
    }),
    "utf8"
  );

  const runtimeConfig = await readConfig(configPath);
  const readinessConfig = await readConfig(configPath, { includeDisabledExternalSources: true });

  assert.deepEqual(runtimeConfig.externalSources?.map((source) => source.id), ["enabled"]);
  assert.deepEqual(readinessConfig.externalSources?.map((source) => source.id), ["enabled", "disabled"]);
});

test("reads UTF-8 config files with a Windows PowerShell BOM", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-price-bom-"));
  const configPath = join(dir, "config.json");
  await writeFile(
    configPath,
    `\uFEFF${JSON.stringify({
      defaultAddressAlias: "公司",
      addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
      browserProfilePath: "D:/profiles/coffee",
      sources: { meituan: true, eleme: false, brandOfficial: false }
    })}`,
    "utf8"
  );

  const config = await readConfig(configPath);

  assert.equal(config.defaultAddressAlias, "公司");
});
