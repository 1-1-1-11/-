import type { DoctorReport, DoctorStatus } from "./doctor.js";
import type { BrowserSourceSelectorAudit } from "./providers/browser-source-provider.js";
import type { BrowserSourceSpec, CoffeePriceConfig, SourceConfig } from "./types.js";

export interface LiveReadinessCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  message: string;
  detail?: string;
}

export interface LiveReadinessReport {
  status: DoctorStatus;
  checks: LiveReadinessCheck[];
}

export interface BuildLiveReadinessReportInput {
  config: CoffeePriceConfig;
  doctor?: DoctorReport;
  audits?: Partial<Record<keyof SourceConfig, BrowserSourceSelectorAudit | null>>;
}

const SOURCE_KEYS = ["meituan", "eleme", "brandOfficial"] as const;

export function buildLiveReadinessReport(
  input: BuildLiveReadinessReportInput
): LiveReadinessReport {
  const checks: LiveReadinessCheck[] = [
    checkDoctor(input.doctor),
    checkBrowserProfile(input.config)
  ];

  for (const source of SOURCE_KEYS) {
    if (!input.config.sources[source]) {
      continue;
    }
    const spec = input.config.browserSources?.[source];
    checks.push(checkSourceConfig(source, spec));
    if (spec) {
      checks.push(checkSourceUrl(source, spec.entryUrl));
    }
    checks.push(checkSourceAudit(source, input.audits?.[source]));
  }

  return {
    status: summarizeStatus(checks),
    checks
  };
}

export function formatLiveReadinessReport(report: LiveReadinessReport): string {
  const lines = [`OpenClaw 咖啡助手现场验收检查`, `总体: ${report.status.toUpperCase()}`];
  for (const check of report.checks) {
    lines.push(`- [${check.status.toUpperCase()}] ${check.label}: ${check.message}`);
    if (check.detail) {
      lines.push(`  ${check.detail}`);
    }
  }
  return lines.join("\n");
}

export function defaultAuditPath(source: keyof SourceConfig): string {
  return `.runtime/captures/${source}.audit.json`;
}

function checkDoctor(doctor: DoctorReport | undefined): LiveReadinessCheck {
  if (!doctor) {
    return warn("doctor", "运行时诊断", "未运行 doctor；现场验收前建议执行 npm run doctor");
  }
  if (doctor.status === "pass") {
    return pass("doctor", "运行时诊断", "doctor 已通过");
  }
  const failing = doctor.checks.filter((check) => check.status === "fail");
  const detail = failing
    .map((check) => [check.label, check.message, check.detail].filter(Boolean).join(" - "))
    .join("; ");
  return {
    id: "doctor",
    label: "运行时诊断",
    status: doctor.status,
    message: doctor.status === "fail" ? "doctor 仍有失败项" : "doctor 仍有警告项",
    detail
  };
}

function checkBrowserProfile(config: CoffeePriceConfig): LiveReadinessCheck {
  if (config.browserProfilePath.trim()) {
    return pass("browser-profile", "浏览器登录态目录", config.browserProfilePath);
  }
  return fail("browser-profile", "浏览器登录态目录", "browserProfilePath 为空");
}

function checkSourceConfig(
  source: keyof SourceConfig,
  spec: BrowserSourceSpec | undefined
): LiveReadinessCheck {
  if (spec) {
    return pass(`source-${source}-config`, `${source} 浏览器源`, "browserSources 已配置");
  }
  return fail(
    `source-${source}-config`,
    `${source} 浏览器源`,
    "该渠道已启用，但没有配置 browserSources；真实现场查价无法从页面提取价格"
  );
}

function checkSourceUrl(source: keyof SourceConfig, entryUrl: string): LiveReadinessCheck {
  if (/^https?:\/\/example\.com(?:[/:?#]|$)/i.test(entryUrl)) {
    return fail(
      `source-${source}-url`,
      `${source} 入口 URL`,
      "仍是 example.com 占位入口 URL",
      "请把 browserSources.<source>.entryUrl 改成真实平台搜索或店铺入口"
    );
  }
  if (/^https?:\/\//i.test(entryUrl)) {
    return pass(`source-${source}-url`, `${source} 入口 URL`, "入口 URL 已设置为网页地址");
  }
  return fail(`source-${source}-url`, `${source} 入口 URL`, "入口 URL 不是 http/https 网页地址");
}

function checkSourceAudit(
  source: keyof SourceConfig,
  audit: BrowserSourceSelectorAudit | null | undefined
): LiveReadinessCheck {
  if (!audit) {
    return fail(
      `source-${source}-audit`,
      `${source} selector 诊断`,
      "缺少 selector audit 文件",
      `运行 npm run capture -- "查公司附近冰美式" --source ${source}`
    );
  }

  const statusHits = Object.entries(audit.statusMatches).filter(([, count]) => count > 0);
  if (statusHits.length > 0) {
    return fail(
      `source-${source}-audit`,
      `${source} selector 诊断`,
      `页面命中不可报价状态: ${statusHits.map(([name]) => name).join(", ")}`
    );
  }

  if (audit.offerRows.count === 0) {
    return fail(
      `source-${source}-audit`,
      `${source} selector 诊断`,
      "offerRows 没有命中任何候选行"
    );
  }

  const missingRows = audit.rows.filter((row) => row.missingRequiredFields.length > 0);
  if (missingRows.length > 0) {
    const preview = missingRows
      .slice(0, 3)
      .map((row) => `#${row.index + 1}: ${row.missingRequiredFields.join(",")}`)
      .join("; ");
    return fail(
      `source-${source}-audit`,
      `${source} selector 诊断`,
      `有 ${missingRows.length} 行缺少必填字段: ${preview}`
    );
  }

  return pass(
    `source-${source}-audit`,
    `${source} selector 诊断`,
    `已捕获 ${audit.offerRows.count} 行可解析候选`
  );
}

function summarizeStatus(checks: LiveReadinessCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

function pass(id: string, label: string, message: string, detail?: string): LiveReadinessCheck {
  return { id, label, status: "pass", message, detail };
}

function warn(id: string, label: string, message: string, detail?: string): LiveReadinessCheck {
  return { id, label, status: "warn", message, detail };
}

function fail(id: string, label: string, message: string, detail?: string): LiveReadinessCheck {
  return { id, label, status: "fail", message, detail };
}
