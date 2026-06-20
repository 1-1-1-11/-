import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildCaptureCalibrationTasks,
  parseCaptureCalibrateCliArgs,
  runCaptureCalibrateCli,
  runCaptureCalibrateCliDetailed
} from "../src/capture-calibrate.js";
import type { CaptureBrowserSourceInput, CaptureBrowserSourceResult } from "../src/browser-capture.js";
import type { CoffeePriceConfig } from "../src/types.js";

const config: CoffeePriceConfig = {
  defaultAddressAlias: "company",
  addresses: [{ alias: "company", label: "Company", query: "Shenzhen Nanshan" }],
  browserProfilePath: ".runtime/browser-profile",
  brands: [{ name: "Luckin", enabled: true }],
  sources: { meituan: true, eleme: true, brandOfficial: false },
  browserSources: {
    meituan: {
      source: "meituan",
      entryUrl: "https://example.com/meituan/search",
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
    },
    eleme: {
      source: "eleme",
      entryUrl: "https://eleme.example.invalid/search?q={{drink}}",
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
};

test("parses batch capture calibration CLI options", () => {
  const parsed = parseCaptureCalibrateCliArgs([
    "查公司附近冰美式",
    "--config",
    "config/live.json",
    "--manual-ms",
    "120000",
    "--url-meituan",
    "https://meituan.example.invalid/coffee",
    "--url-eleme",
    "https://eleme.example.invalid/coffee",
    "--url-brand",
    "https://brand.example.invalid/coffee"
  ]);

  assert.equal(parsed.message, "查公司附近冰美式");
  assert.equal(parsed.configPath, "config/live.json");
  assert.equal(parsed.manualWaitMs, 120000);
  assert.equal(parsed.urls.meituan, "https://meituan.example.invalid/coffee");
  assert.equal(parsed.urls.eleme, "https://eleme.example.invalid/coffee");
  assert.equal(parsed.urls.brandOfficial, "https://brand.example.invalid/coffee");
});

test("batch calibration rejects enabled placeholder URLs without an override", () => {
  const options = parseCaptureCalibrateCliArgs(["查公司附近冰美式"]);

  assert.throws(
    () => buildCaptureCalibrationTasks(config, options),
    /meituan.*--url-meituan/
  );
});

test("batch calibration captures every enabled source and saves only overridden URLs", async () => {
  const calls: CaptureBrowserSourceInput[] = [];

  const result = await runCaptureCalibrateCli(
    [
      "查公司附近冰美式",
      "--url-meituan",
      "https://meituan.example.invalid/coffee",
      "--manual-ms",
      "5000"
    ],
    {
      readConfig: async () => config,
      capture: async (input) => {
        calls.push(input);
        return mockCaptureResult(input);
      }
    }
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.source, "meituan");
  assert.equal(calls[0]?.entryUrlOverride, "https://meituan.example.invalid/coffee");
  assert.equal(calls[0]?.saveEntryUrl, true);
  assert.equal(calls[0]?.manualWaitMs, 5000);
  assert.equal(calls[1]?.source, "eleme");
  assert.equal(calls[1]?.entryUrlOverride, undefined);
  assert.equal(calls[1]?.saveEntryUrl, false);
  assert.match(result, /meituan/);
  assert.match(result, /eleme/);
});

test("batch calibration continues after one source capture fails", async () => {
  const calls: CaptureBrowserSourceInput[] = [];

  const result = await runCaptureCalibrateCliDetailed(
    [
      "查公司附近冰美式",
      "--url-meituan",
      "https://meituan.example.invalid/coffee"
    ],
    {
      readConfig: async () => config,
      capture: async (input) => {
        calls.push(input);
        if (input.source === "meituan") {
          throw new Error("captcha required");
        }
        return mockCaptureResult(input);
      }
    }
  );

  assert.equal(calls.length, 2);
  assert.equal(result.exitCode, 1);
  assert.match(result.text, /\[meituan\] FAILED: captcha required/);
  assert.match(result.text, /\[eleme\]/);
});

test("package exposes batch capture calibration script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["capture:calibrate"], /capture-calibrate\.ts/);
});

function mockCaptureResult(input: CaptureBrowserSourceInput): CaptureBrowserSourceResult {
  return {
    url: input.entryUrlOverride ?? `https://${input.source}.example.invalid/search`,
    htmlPath: input.htmlPath,
    snapshotPath: input.snapshotPath,
    auditPath: input.auditPath,
    snapshot: { source: input.source, offers: [] },
    selectorAudit: {
      source: input.source,
      statusMatches: { loginRequired: 0, captchaRequired: 0, noStock: 0 },
      offerRows: { selector: "[data-offer]", count: 1 },
      rows: []
    }
  };
}
