import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseVerifyLiveCliArgs,
  runVerifyLiveCli
} from "../src/verify-live-cli.js";
import type { CaptureCalibrationReport } from "../src/capture-calibrate.js";
import type { BrowserSourceSelectorAudit } from "../src/providers/browser-source-provider.js";
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
      entryUrl: "https://meituan.example.invalid/search?q={{drink}}",
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

const audit: BrowserSourceSelectorAudit = {
  source: "meituan",
  statusMatches: { loginRequired: 0, captchaRequired: 0, noStock: 0 },
  offerRows: { selector: "[data-offer]", count: 1 },
  rows: [
    {
      index: 0,
      fieldMatches: {
        brand: 1,
        storeName: 1,
        drinkName: 1,
        fulfillment: 1,
        itemPrice: 1
      },
      missingRequiredFields: []
    }
  ]
};

test("parses live verification CLI defaults and audit overrides", () => {
  const parsed = parseVerifyLiveCliArgs([
    "--config",
    "config/live.json",
    "--audit-meituan",
    ".runtime/live/meituan.audit.json",
    "--calibration-report",
    ".runtime/live/calibration-report.json",
    "--skip-doctor"
  ]);

  assert.equal(parsed.configPath, "config/live.json");
  assert.equal(parsed.auditPaths.meituan, ".runtime/live/meituan.audit.json");
  assert.equal(parsed.auditPaths.eleme, ".runtime/captures/eleme.audit.json");
  assert.equal(parsed.calibrationReportPath, ".runtime/live/calibration-report.json");
  assert.equal(parsed.skipDoctor, true);
});

test("parses default live calibration report path", () => {
  const parsed = parseVerifyLiveCliArgs([]);

  assert.equal(parsed.calibrationReportPath, ".runtime/captures/calibration-report.json");
});

test("live verification CLI returns a passing report from injected healthy dependencies", async () => {
  const result = await runVerifyLiveCli([], {
    readConfig: async () => config,
    runDoctor: async () => ({ status: "pass", checks: [] }),
    readAudit: async () => audit,
    readCalibrationReport: async () => null
  });

  assert.equal(result.report.status, "pass");
  assert.equal(result.exitCode, 0);
  assert.match(result.text, /总体: PASS/);
});

test("live verification CLI includes failed calibration report details", async () => {
  const calibrationReport: CaptureCalibrationReport = {
    status: "fail",
    generatedAt: "2026-06-20T00:00:00.000Z",
    message: "查公司附近冰美式",
    results: [
      {
        source: "meituan",
        status: "fail",
        savedEntryUrl: true,
        error: "captcha required"
      }
    ]
  };

  const result = await runVerifyLiveCli([], {
    readConfig: async () => config,
    runDoctor: async () => ({ status: "pass", checks: [] }),
    readAudit: async () => audit,
    readCalibrationReport: async () => calibrationReport
  });

  assert.equal(result.report.status, "warn");
  assert.equal(result.exitCode, 0);
  assert.match(result.text, /批量校准报告/);
  assert.match(result.text, /meituan: captcha required/);
});

test("package exposes live verification script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["verify:live"], /verify-live\.ts/);
});
