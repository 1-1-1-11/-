import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLiveReadinessReport,
  formatLiveReadinessReport
} from "../src/live-readiness.js";
import type { BrowserSourceSelectorAudit } from "../src/providers/browser-source-provider.js";
import type { CoffeePriceConfig } from "../src/types.js";

const baseConfig: CoffeePriceConfig = {
  defaultAddressAlias: "company",
  addresses: [{ alias: "company", label: "Company", query: "Shenzhen Nanshan" }],
  browserProfilePath: ".runtime/browser-profile",
  openLowestPurchasePage: true,
  brands: [{ name: "Luckin", enabled: true }],
  sources: { meituan: true, eleme: false, brandOfficial: false },
  browserSources: {
    meituan: {
      source: "meituan",
      entryUrl: "https://example.com/search?q={{drink}}",
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

const cleanAudit: BrowserSourceSelectorAudit = {
  source: "meituan",
  statusMatches: { loginRequired: 0, captchaRequired: 0, noStock: 0 },
  offerRows: { selector: "[data-offer]", count: 2 },
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

test("live readiness fails on doctor failure, placeholder URLs, and missing selector audit", () => {
  const report = buildLiveReadinessReport({
    config: baseConfig,
    doctor: {
      status: "fail",
      checks: [
        {
          id: "weixin-login",
          label: "微信扫码登录",
          status: "fail",
          message: "微信 channel 尚未完成扫码登录",
          detail: "运行 npm run weixin:login"
        }
      ]
    },
    audits: {}
  });

  assert.equal(report.status, "fail");
  assert.equal(report.checks.find((check) => check.id === "doctor")?.status, "fail");
  assert.equal(report.checks.find((check) => check.id === "source-meituan-url")?.status, "fail");
  assert.equal(report.checks.find((check) => check.id === "source-meituan-audit")?.status, "fail");
  assert.match(formatLiveReadinessReport(report), /npm run capture/);
});

test("live readiness passes with healthy doctor, real source URL, and clean selector audit", () => {
  const config: CoffeePriceConfig = {
    ...baseConfig,
    browserSources: {
      meituan: {
        ...baseConfig.browserSources!.meituan!,
        entryUrl: "https://meituan.example.invalid/search?q={{drink}}"
      }
    }
  };

  const report = buildLiveReadinessReport({
    config,
    doctor: { status: "pass", checks: [] },
    audits: { meituan: cleanAudit }
  });

  assert.equal(report.status, "pass");
  assert.equal(report.checks.every((check) => check.status === "pass"), true);
});

test("live readiness fails when captured rows miss required pricing fields", () => {
  const config: CoffeePriceConfig = {
    ...baseConfig,
    browserSources: {
      meituan: {
        ...baseConfig.browserSources!.meituan!,
        entryUrl: "https://meituan.example.invalid/search?q={{drink}}"
      }
    }
  };
  const audit: BrowserSourceSelectorAudit = {
    ...cleanAudit,
    rows: [{ ...cleanAudit.rows[0]!, missingRequiredFields: ["itemPrice"] }]
  };

  const report = buildLiveReadinessReport({
    config,
    doctor: { status: "pass", checks: [] },
    audits: { meituan: audit }
  });

  assert.equal(report.status, "fail");
  assert.match(report.checks.find((check) => check.id === "source-meituan-audit")?.message ?? "", /itemPrice/);
});
