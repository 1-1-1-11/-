import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parsePriceBookRefreshArgs,
  refreshPriceBook,
  runPriceBookRefreshCli
} from "../src/pricebook-refresh.js";
import type { PriceBook } from "../src/types.js";

const OFFICE = "\u516c\u53f8";
const OFFICE_QUERY = "\u6df1\u5733\u5357\u5c71\u79d1\u6280\u56ed";
const ICED_AMERICANO = "\u51b0\u7f8e\u5f0f";
const QUERY_MESSAGE = "\u67e5\u516c\u53f8\u9644\u8fd1\u51b0\u7f8e\u5f0f";

test("parses refresh CLI options for automation", () => {
  const parsed = parsePriceBookRefreshArgs([
    "--config",
    "config/local.json",
    "--out",
    "config/live-pricebook.json",
    "--query",
    QUERY_MESSAGE,
    "--json"
  ]);

  assert.equal(parsed.configPath, "config/local.json");
  assert.equal(parsed.outputPath, "config/live-pricebook.json");
  assert.deepEqual(parsed.queries, [{ message: QUERY_MESSAGE }]);
  assert.equal(parsed.outputFormat, "json");
});

test("refreshes price book from enabled external sources and preserves other drinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-pricebook-refresh-"));
  const configDir = join(dir, "config");
  const scriptDir = join(dir, "scripts");
  await mkdir(configDir, { recursive: true });
  await mkdir(scriptDir, { recursive: true });
  const configPath = join(configDir, "coffee-price.config.json");
  const priceBookPath = join(configDir, "pricebook.json");
  const scriptPath = join(scriptDir, "source.mjs");

  await writeFile(
    scriptPath,
    [
      "let body = '';",
      "for await (const chunk of process.stdin) body += chunk;",
      "const request = JSON.parse(body);",
      "console.log(JSON.stringify({",
      "  source: 'feed',",
      "  offers: [{",
      "    brand: 'TestCoffee',",
      "    storeName: request.address.label,",
      `    drinkName: ${JSON.stringify(ICED_AMERICANO)},`,
      "    normalizedDrink: request.query.normalizedDrink,",
      "    size: request.query.size,",
      "    fulfillment: 'pickup',",
      "    itemPrice: 12.9,",
      "    discounts: [{ label: 'feed-coupon', amount: 3 }],",
      "    purchaseUrl: 'https://example.com/testcoffee'",
      "  }]",
      "}));"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    configPath,
    JSON.stringify({
      defaultAddressAlias: OFFICE,
      addresses: [{ alias: OFFICE, label: OFFICE, query: OFFICE_QUERY }],
      browserProfilePath: ".runtime/browser-profile",
      priceBookPath: "config/pricebook.json",
      priceBookRefresh: {
        outputPath: "config/pricebook.json",
        mergeExisting: true,
        queries: [{ message: QUERY_MESSAGE }]
      },
      brands: [{ name: "TestCoffee", enabled: true }],
      sources: { priceBook: true, meituan: false, eleme: false, brandOfficial: false },
      externalSources: [
        {
          id: "feed",
          command: process.execPath,
          args: ["scripts/source.mjs"],
          timeoutMs: 10_000
        }
      ]
    }),
    "utf8"
  );
  await writeFile(
    priceBookPath,
    JSON.stringify({
      source: "priceBook",
      offers: [
        {
          addressAliases: [OFFICE],
          brand: "OldCoffee",
          storeName: "OldCoffee",
          drinkName: "\u62ff\u94c1",
          normalizedDrink: "latte",
          size: null,
          fulfillment: "pickup",
          itemPrice: 18
        }
      ]
    }),
    "utf8"
  );

  const summary = await refreshPriceBook(
    {
      configPath,
      queries: [],
      outputFormat: "text"
    },
    { now: () => new Date("2026-06-21T02:00:00.000Z") }
  );
  const updated = JSON.parse(await readFile(priceBookPath, "utf8")) as PriceBook;

  assert.equal(summary.refreshedOffers, 1);
  assert.equal(summary.retainedOffers, 1);
  assert.equal(updated.updatedAt, "2026-06-21T02:00:00.000Z");
  assert.ok(updated.offers?.some((offer) => offer.brand === "TestCoffee" && offer.source === "feed" && offer.purchaseUrl));
  assert.ok(updated.offers?.some((offer) => offer.brand === "OldCoffee"));

  const cli = await runPriceBookRefreshCli(["--config", configPath, "--json"], {
    now: () => new Date("2026-06-21T02:05:00.000Z")
  });
  assert.equal(cli.exitCode, 0);
  assert.equal(JSON.parse(cli.text).updatedAt, "2026-06-21T02:05:00.000Z");
});

test("refresh CLI fails clearly when no external source is enabled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-pricebook-refresh-empty-"));
  const configPath = join(dir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      addresses: [{ alias: OFFICE, label: OFFICE, query: OFFICE_QUERY }],
      priceBookRefresh: {
        queries: [{ message: QUERY_MESSAGE }]
      },
      sources: { priceBook: true, meituan: false, eleme: false, brandOfficial: false },
      externalSources: []
    }),
    "utf8"
  );

  const result = await runPriceBookRefreshCli(["--config", configPath]);

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /externalSources/);
});

test("price book preserves per-offer external source labels", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coffee-pricebook-refresh-source-"));
  const configDir = join(dir, "config");
  const scriptDir = join(dir, "scripts");
  await mkdir(configDir, { recursive: true });
  await mkdir(scriptDir, { recursive: true });
  const configPath = join(configDir, "coffee-price.config.json");
  const priceBookPath = join(configDir, "pricebook.json");
  const scriptPath = join(scriptDir, "source.mjs");

  await writeFile(
    scriptPath,
    [
      "let body = '';",
      "for await (const chunk of process.stdin) body += chunk;",
      "const request = JSON.parse(body);",
      "console.log(JSON.stringify({",
      "  source: 'aggregator',",
      "  offers: [{",
      "    source: 'luckinMcp',",
      "    brand: '瑞幸',",
      "    storeName: '瑞幸 科技园店',",
      `    drinkName: ${JSON.stringify(ICED_AMERICANO)},`,
      "    normalizedDrink: request.query.normalizedDrink,",
      "    size: request.query.size,",
      "    fulfillment: 'pickup',",
      "    itemPrice: 12.9",
      "  }]",
      "}));"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    configPath,
    JSON.stringify({
      defaultAddressAlias: OFFICE,
      addresses: [{ alias: OFFICE, label: OFFICE, query: OFFICE_QUERY }],
      browserProfilePath: ".runtime/browser-profile",
      priceBookPath: "config/pricebook.json",
      priceBookRefresh: { outputPath: "config/pricebook.json", queries: [{ message: QUERY_MESSAGE }] },
      brands: [{ name: "瑞幸", enabled: true }],
      sources: { priceBook: true, meituan: false, eleme: false, brandOfficial: false },
      externalSources: [{ id: "aggregator", command: process.execPath, args: ["scripts/source.mjs"] }]
    }),
    "utf8"
  );

  await refreshPriceBook({ configPath, queries: [], outputFormat: "text" });
  const updated = JSON.parse(await readFile(priceBookPath, "utf8")) as PriceBook;

  assert.equal(updated.offers?.[0]?.source, "luckinMcp");
});
