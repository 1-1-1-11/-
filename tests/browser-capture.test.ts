import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { captureBrowserSource } from "../src/browser-capture.js";
import type { BrowserPageLoadRequest } from "../src/browser-capture.js";

test("captures a configured browser source into HTML and snapshot files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-capture-"));
  const configPath = join(dir, "config.json");
  const htmlPath = join(dir, "captures", "meituan.html");
  const snapshotPath = join(dir, "captures", "meituan.snapshot.json");
  const auditPath = join(dir, "captures", "meituan.audit.json");
  const requests: BrowserPageLoadRequest[] = [];

  await writeFile(
    configPath,
    JSON.stringify({
      defaultAddressAlias: "公司",
      addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
      browserProfilePath: "D:/profiles/coffee",
      sources: { meituan: true, eleme: false, brandOfficial: false },
      browserSources: {
        meituan: {
          source: "meituan",
          entryUrl: "https://example.com/search?address={{addressQuery}}&drink={{drink}}",
          selectors: {
            offerRows: "[data-offer]",
            fields: {
              brand: "[data-brand]",
              storeName: "[data-store]",
              drinkName: "[data-drink]",
              normalizedDrink: "[data-normalized-drink]",
              fulfillment: "[data-fulfillment]",
              itemPrice: "[data-item-price]",
              purchaseUrl: "[data-purchase-url]"
            }
          },
          browser: {
            search: {
              inputSelector: "input[type=search]",
              submitSelector: "button[type=submit]"
            }
          }
        }
      }
    }),
    "utf8"
  );

  const result = await captureBrowserSource({
    configPath,
    source: "meituan",
    message: "查公司附近冰美式",
    htmlPath,
    snapshotPath,
    auditPath,
    pageLoader: async (request) => {
      requests.push(request);
      return {
        url: "https://example.com/search/result",
        html: `
          <article data-offer>
            <span data-brand>瑞幸</span>
            <span data-store>瑞幸 科技园店</span>
            <span data-drink>冰美式</span>
            <span data-normalized-drink>americano</span>
            <span data-fulfillment>自取</span>
            <span data-item-price>¥6.90</span>
            <a data-purchase-url href="/order/luckin">购买</a>
          </article>
        `
      };
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.profilePath, "D:/profiles/coffee");
  assert.equal(requests[0]?.searchText, "冰美式");
  assert.equal(requests[0]?.spec.browser?.search?.inputSelector, "input[type=search]");
  assert.equal(
    requests[0]?.url,
    "https://example.com/search?address=%E6%B7%B1%E5%9C%B3%E5%8D%97%E5%B1%B1%E5%8C%BA%E7%A7%91%E6%8A%80%E5%9B%AD&drink=%E5%86%B0%E7%BE%8E%E5%BC%8F"
  );
  assert.match(await readFile(htmlPath, "utf8"), /瑞幸 科技园店/);

  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert.equal(snapshot.source, "meituan");
  assert.equal(snapshot.offers[0].brand, "瑞幸");
  assert.equal(snapshot.offers[0].purchaseUrl, "https://example.com/order/luckin");
  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  assert.equal(audit.offerRows.count, 1);
  assert.deepEqual(audit.rows[0].missingRequiredFields, []);
  assert.equal(result.auditPath, auditPath);
  assert.equal(result.selectorAudit.offerRows.count, 1);
  assert.equal(result.snapshotPath, snapshotPath);
});

test("captures a browser source from an explicit entry URL override", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-capture-url-"));
  const configPath = join(dir, "config.json");
  const htmlPath = join(dir, "captures", "meituan.html");
  const snapshotPath = join(dir, "captures", "meituan.snapshot.json");
  const requests: BrowserPageLoadRequest[] = [];

  await writeFile(
    configPath,
    JSON.stringify({
      defaultAddressAlias: "公司",
      addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
      browserProfilePath: "D:/profiles/coffee",
      sources: { meituan: true, eleme: false, brandOfficial: false },
      browserSources: {
        meituan: {
          source: "meituan",
          entryUrl: "https://example.com/from-config?drink={{drink}}",
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

  await captureBrowserSource({
    configPath,
    source: "meituan",
    message: "查公司附近冰美式",
    htmlPath,
    snapshotPath,
    entryUrlOverride: "https://example.com/manual-entry",
    pageLoader: async (request) => {
      requests.push(request);
      return {
        url: request.url,
        html: ""
      };
    }
  });

  assert.equal(requests[0]?.url, "https://example.com/manual-entry");
});

test("persists an explicit capture URL without replacing selectors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-capture-save-url-"));
  const configPath = join(dir, "config.json");
  const htmlPath = join(dir, "captures", "meituan.html");
  const snapshotPath = join(dir, "captures", "meituan.snapshot.json");

  await writeFile(
    configPath,
    JSON.stringify({
      defaultAddressAlias: "公司",
      addresses: [{ alias: "公司", label: "公司", query: "深圳南山区科技园" }],
      browserProfilePath: "D:/profiles/coffee",
      sources: { meituan: true, eleme: false, brandOfficial: false },
      browserSources: {
        meituan: {
          source: "meituan",
          entryUrl: "https://example.com/from-config?drink={{drink}}",
          selectors: {
            offerRows: "[data-live-offer]",
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

  await captureBrowserSource({
    configPath,
    source: "meituan",
    message: "查公司附近冰美式",
    htmlPath,
    snapshotPath,
    entryUrlOverride: "https://example.com/manual-entry",
    saveEntryUrl: true,
    pageLoader: async (request) => ({
      url: request.url,
      html: ""
    })
  });

  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(saved.browserSources.meituan.entryUrl, "https://example.com/manual-entry");
  assert.equal(saved.browserSources.meituan.selectors.offerRows, "[data-live-offer]");
  assert.equal(saved.sources.meituan, true);
});
