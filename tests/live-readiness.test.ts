import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLiveReadinessReport,
  formatLiveReadinessReport
} from "../src/live-readiness.js";
import type { BrowserNetworkLogEntry } from "../src/browser-capture.js";
import type { CaptureCalibrationReport } from "../src/capture-calibrate.js";
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
  statusMatches: { loginRequired: 0, captchaRequired: 0, noStock: 0, unavailable: 0 },
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
  assert.deepEqual(
    report.actions.map((action) => action.id),
    ["weixin-login", "replace-source-url:meituan"]
  );
  assert.match(report.actions[0]?.command ?? "", /npm run weixin:login/);
  assert.match(report.actions[0]?.command ?? "", /--open-qr/);
  assert.match(report.actions[0]?.command ?? "", /--qr-url-file \.runtime\/weixin-login\/qr-url\.txt/);
  assert.match(report.actions[0]?.command ?? "", /--qr-html-file \.runtime\/weixin-login\/qr\.html/);
  const text = formatLiveReadinessReport(report);
  assert.match(text, /npm run capture/);
  assert.match(text, /--url "<real-platform-url>"/);
  assert.match(text, /--save-url/);
  assert.doesNotMatch(text, /capture-audit:meituan/);
});

test("live readiness suggests batch calibration when multiple source URLs are placeholders", () => {
  const config: CoffeePriceConfig = {
    ...baseConfig,
    sources: { meituan: true, eleme: true, brandOfficial: true },
    browserSources: {
      meituan: baseConfig.browserSources!.meituan!,
      eleme: {
        ...baseConfig.browserSources!.meituan!,
        source: "eleme",
        entryUrl: "https://example.com/eleme/search?q={{drink}}"
      },
      brandOfficial: {
        ...baseConfig.browserSources!.meituan!,
        source: "brandOfficial",
        entryUrl: "https://example.com/brand/search?q={{drink}}"
      }
    }
  };

  const report = buildLiveReadinessReport({
    config,
    doctor: { status: "pass", checks: [] },
    audits: {}
  });
  const text = formatLiveReadinessReport(report);

  assert.match(text, /npm run capture:calibrate/);
  assert.match(text, /--url-meituan "<real-meituan-url>"/);
  assert.match(text, /--url-eleme "<real-eleme-url>"/);
  assert.match(text, /--url-brand "<real-brand-url>"/);
  assert.equal(text.match(/npm run capture:calibrate/g)?.length, 1);
  assert.equal(report.actions[0]?.id, "batch-calibrate");
  assert.equal(report.actions.some((action) => action.id.startsWith("capture-audit:")), false);
});

test("live readiness suggests external source setup when all realtime sources are disabled", () => {
  const config: CoffeePriceConfig = {
    ...baseConfig,
    sources: { meituan: false, eleme: false, brandOfficial: false },
    externalSources: [
      { id: "luckinMcp", label: "瑞幸官方 MCP", enabled: false },
      { id: "meituanApp", label: "美团 App 自动化", enabled: false },
      { id: "orderwiseCli", label: "OrderWise CLI 直连", enabled: false },
      { id: "orderwiseMcp", label: "OrderWise 多平台 MCP", enabled: false }
    ]
  };

  const report = buildLiveReadinessReport({
    config,
    doctor: { status: "pass", checks: [] },
    audits: {}
  });

  assert.equal(report.status, "warn");
  assert.equal(report.checks.find((check) => check.id === "external-sources")?.status, "warn");
  assert.deepEqual(
    report.actions.map((action) => action.id),
    [
      "configure-external-source:orderwiseCli",
      "configure-external-source:luckinMcp",
      "configure-external-source:meituanApp"
    ]
  );
  assert.match(report.actions[0]?.command ?? "", /npm run orderwise:configure/);
  assert.match(report.actions[0]?.command ?? "", /--source-kind cli/);
  assert.match(report.actions[0]?.command ?? "", /--auto-adb/);
  assert.match(report.actions[0]?.command ?? "", /--source-apps "美团"/);
  assert.match(report.actions[0]?.command ?? "", /--orderwise-model-url/);
  assert.match(report.actions[1]?.command ?? "", /luckin:official-login/);
  assert.match(report.actions[2]?.command ?? "", /meituan:doctor/);
});

test("live readiness points OrderWise setup at ADB when the CLI doctor sees no device", () => {
  const config: CoffeePriceConfig = {
    ...baseConfig,
    sources: { meituan: false, eleme: false, brandOfficial: false },
    externalSources: [
      { id: "orderwiseCli", label: "OrderWise CLI 直连", enabled: false }
    ]
  };

  const report = buildLiveReadinessReport({
    config,
    doctor: { status: "pass", checks: [] },
    audits: {},
    orderwiseDoctor: {
      status: "fail",
      checks: [
        {
          id: "cli",
          label: "OrderWise CLI",
          status: "pass",
          message: "python ok"
        },
        {
          id: "adb",
          label: "ADB 设备",
          status: "fail",
          message: "ADB 可执行，但未检测到已授权 Android 设备",
          detail: "adb=C:\\tools\\adb.exe\nList of devices attached"
        },
        {
          id: "device-mapping",
          label: "设备映射",
          status: "fail",
          message: "设备映射仍是占位值"
        }
      ]
    }
  });

  assert.equal(report.checks.find((check) => check.id === "external-source:orderwiseCli")?.status, "warn");
  assert.equal(report.actions[0]?.id, "connect-orderwise-adb-device");
  assert.match(report.actions[0]?.command ?? "", /orderwise:configure/);
  assert.match(report.actions[0]?.command ?? "", /--connect-adb/);
  assert.match(report.actions[0]?.command ?? "", /--meituan "<cloud-phone-host:port>"/);
  assert.match(report.actions[0]?.command ?? "", /orderwise:doctor -- --source-kind cli/);
});

test("live readiness keeps realtime alternatives visible when enabled Luckin is not ready", () => {
  const config: CoffeePriceConfig = {
    ...baseConfig,
    sources: { meituan: false, eleme: false, brandOfficial: false },
    externalSources: [
      { id: "luckinMcp", label: "瑞幸官方 CLI", enabled: true },
      { id: "orderwiseCli", label: "OrderWise CLI 直连", enabled: false },
      { id: "orderwiseMcp", label: "OrderWise 多平台 MCP", enabled: false },
      { id: "meituanApp", label: "美团 App 自动化", enabled: false }
    ]
  };

  const report = buildLiveReadinessReport({
    config,
    doctor: { status: "pass", checks: [] },
    audits: {},
    luckinDoctor: {
      status: "fail",
      checks: [
        {
          id: "token",
          label: "瑞幸 token",
          status: "fail",
          message: "未检测到 token"
        }
      ]
    }
  });

  assert.deepEqual(report.actions.map((action) => action.id), [
    "configure-external-source:orderwiseCli",
    "configure-external-source:luckinMcp",
    "configure-external-source:meituanApp"
  ]);
  assert.match(report.actions[0]?.command ?? "", /--auto-adb/);
  assert.match(report.actions[0]?.command ?? "", /--source-kind cli/);
  assert.match(report.actions[1]?.command ?? "", /luckin:official-login/);
});

test("live readiness warns when enabled Luckin source lacks token", () => {
  const config: CoffeePriceConfig = {
    ...baseConfig,
    sources: { meituan: false, eleme: false, brandOfficial: false },
    externalSources: [
      { id: "luckinMcp", label: "瑞幸官方 CLI", enabled: true }
    ]
  };

  const report = buildLiveReadinessReport({
    config,
    doctor: { status: "pass", checks: [] },
    audits: {},
    luckinDoctor: {
      status: "fail",
      checks: [
        {
          id: "token",
          label: "瑞幸 token",
          status: "fail",
          message: "未检测到 token"
        }
      ]
    }
  });

  assert.equal(report.status, "warn");
  assert.equal(report.checks.find((check) => check.id === "external-source:luckinMcp")?.status, "warn");
  assert.deepEqual(report.actions.map((action) => action.id), ["configure-external-source:luckinMcp"]);
  assert.match(report.actions[0]?.command ?? "", /luckin:official-login/);
});

test("live readiness actions suggest selector capture after a real source URL is configured", () => {
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
    audits: {}
  });

  assert.deepEqual(
    report.actions.map((action) => action.id),
    ["capture-audit:meituan"]
  );
  assert.match(report.actions[0]?.command ?? "", /--source meituan/);
  assert.match(report.actions[0]?.command ?? "", /--manual-ms 120000/);
});

test("live readiness includes failed batch calibration report details", () => {
  const config: CoffeePriceConfig = {
    ...baseConfig,
    browserSources: {
      meituan: {
        ...baseConfig.browserSources!.meituan!,
        entryUrl: "https://meituan.example.invalid/search?q={{drink}}"
      }
    }
  };
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

  const report = buildLiveReadinessReport({
    config,
    doctor: { status: "pass", checks: [] },
    audits: { meituan: cleanAudit },
    calibrationReport
  });
  const text = formatLiveReadinessReport(report);

  assert.equal(report.status, "warn");
  assert.match(text, /批量校准报告/);
  assert.match(text, /meituan: captcha required/);
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

test("live readiness includes network failures when captured page is not quoteable", () => {
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
    source: "meituan",
    statusMatches: { loginRequired: 0, captchaRequired: 0, noStock: 0, unavailable: 1 },
    offerRows: { selector: "[data-offer]", count: 0 },
    rows: []
  };
  const networkLog: BrowserNetworkLogEntry[] = [
    {
      event: "response",
      status: 403,
      statusText: "Forbidden",
      method: "POST",
      resourceType: "xhr",
      url: "https://i.waimai.meituan.com/openh5/search/globalpage?<redacted>"
    }
  ];

  const report = buildLiveReadinessReport({
    config,
    doctor: { status: "pass", checks: [] },
    audits: { meituan: audit },
    networkLogs: { meituan: networkLog }
  });
  const check = report.checks.find((candidate) => candidate.id === "source-meituan-audit");

  assert.match(check?.detail ?? "", /403 Forbidden/);
  assert.match(check?.detail ?? "", /globalpage/);
});
