import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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
  assert.equal(config.sources.meituan, true);
  assert.equal(config.browserSources?.meituan?.entryUrl, "https://example.com?q={{drink}}");
  assert.ok(DEFAULT_BRANDS.includes("瑞幸"));
  assert.ok(config.brands.some((brand) => brand.name === "星巴克" && brand.enabled));
});
