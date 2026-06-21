import type { DoctorReport, DoctorStatus } from "./doctor.js";
import type { BrowserNetworkLogEntry } from "./browser-capture.js";
import type { CaptureCalibrationReport } from "./capture-calibrate.js";
import { LUCKIN_WECHAT_TOKEN_BIND_COMMAND } from "./luckin-token-guidance.js";
import type { LuckinDoctorReport } from "./luckin-mcp-doctor.js";
import type { OrderWiseDoctorReport } from "./orderwise-mcp-doctor.js";
import type { BrowserSourceSelectorAudit } from "./providers/browser-source-provider.js";
import type { BrowserSourceSpec, CoffeePriceConfig } from "./types.js";

type BrowserPlatformSource = "meituan" | "eleme" | "brandOfficial";

export interface LiveReadinessCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  message: string;
  detail?: string;
}

export interface LiveReadinessAction {
  id: string;
  label: string;
  reason: string;
  command?: string;
  source?: BrowserPlatformSource;
}

export interface LiveReadinessReport {
  status: DoctorStatus;
  checks: LiveReadinessCheck[];
  actions: LiveReadinessAction[];
}

export interface BuildLiveReadinessReportInput {
  config: CoffeePriceConfig;
  doctor?: DoctorReport;
  audits?: Partial<Record<BrowserPlatformSource, BrowserSourceSelectorAudit | null>>;
  networkLogs?: Partial<Record<BrowserPlatformSource, BrowserNetworkLogEntry[] | null>>;
  calibrationReport?: CaptureCalibrationReport | null;
  luckinDoctor?: LuckinDoctorReport | null;
  orderwiseDoctor?: OrderWiseDoctorReport | null;
}

const SOURCE_KEYS: readonly BrowserPlatformSource[] = ["meituan", "eleme", "brandOfficial"];

export function buildLiveReadinessReport(
  input: BuildLiveReadinessReportInput
): LiveReadinessReport {
  const checks: LiveReadinessCheck[] = [
    checkDoctor(input.doctor),
    checkBrowserProfile(input.config)
  ];
  const externalSourcesCheck = checkExternalSources(input.config);
  if (externalSourcesCheck) {
    checks.push(externalSourcesCheck);
  }
  const luckinCheck = checkLuckinRealtimeSource(input.config, input.luckinDoctor);
  if (luckinCheck) {
    checks.push(luckinCheck);
  }
  const orderwiseCheck = checkOrderWiseCliRealtimeSource(input.config, input.orderwiseDoctor);
  if (orderwiseCheck) {
    checks.push(orderwiseCheck);
  }
  if (input.calibrationReport) {
    checks.push(checkCalibrationReport(input.calibrationReport));
  }

  for (const source of SOURCE_KEYS) {
    if (!input.config.sources[source]) {
      continue;
    }
    const spec = input.config.browserSources?.[source];
    checks.push(checkSourceConfig(source, spec));
    if (spec) {
      checks.push(checkSourceUrl(source, spec.entryUrl));
    }
    checks.push(checkSourceAudit(source, input.audits?.[source], input.networkLogs?.[source]));
  }

  return {
    status: summarizeStatus(checks),
    checks,
    actions: buildLiveReadinessActions(input)
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
  if (report.actions.length > 0) {
    lines.push("下一步动作:");
    for (const [index, action] of report.actions.entries()) {
      lines.push(`${index + 1}. ${action.label}: ${action.command ?? action.reason}`);
      if (action.command && action.reason) {
        lines.push(`   ${action.reason}`);
      }
    }
  }
  return lines.join("\n");
}

export function defaultAuditPath(source: BrowserPlatformSource): string {
  return `.runtime/captures/${source}.audit.json`;
}

export function defaultNetworkPath(source: BrowserPlatformSource): string {
  return `.runtime/captures/${source}.network.json`;
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

function checkExternalSources(config: CoffeePriceConfig): LiveReadinessCheck | undefined {
  const externalSources = config.externalSources ?? [];
  if (externalSources.length === 0) {
    return undefined;
  }
  const enabled = externalSources.filter((source) => source.enabled !== false);
  if (enabled.length > 0) {
    return pass(
      "external-sources",
      "实时外部源",
      `已启用 ${enabled.length} 个 MCP/授权实时源`
    );
  }
  const candidates = externalSources
    .map((source) => source.label ?? source.id)
    .join(", ");
  return warn(
    "external-sources",
    "实时外部源",
    "未启用 MCP/授权实时源；当前会使用本地价格库和城市参考价",
    candidates ? `可配置源: ${candidates}` : undefined
  );
}

function checkLuckinRealtimeSource(
  config: CoffeePriceConfig,
  luckinDoctor: LuckinDoctorReport | null | undefined
): LiveReadinessCheck | undefined {
  const luckinSource = config.externalSources?.find((source) => source.id === "luckinMcp");
  if (!luckinSource || luckinSource.enabled === false || !luckinDoctor) {
    return undefined;
  }
  if (luckinDoctor.status === "pass") {
    return pass("external-source:luckinMcp", "瑞幸官方 CLI 实时源", "瑞幸 token、地址和 source 已通过专项检查");
  }
  const failing = luckinDoctor.checks
    .filter((check) => check.status !== "pass")
    .map((check) => [check.label, check.message].filter(Boolean).join(": "))
    .join("; ");
  return warn(
    "external-source:luckinMcp",
    "瑞幸官方 CLI 实时源",
    "瑞幸实时自取价尚未 ready；微信查价会继续使用其它可用来源",
    failing || undefined
  );
}

function checkOrderWiseCliRealtimeSource(
  config: CoffeePriceConfig,
  orderwiseDoctor: OrderWiseDoctorReport | null | undefined
): LiveReadinessCheck | undefined {
  const source = config.externalSources?.find((entry) => entry.id === "orderwiseCli");
  if (!source || !orderwiseDoctor) {
    return undefined;
  }
  if (orderwiseDoctor.status === "pass") {
    return pass("external-source:orderwiseCli", "OrderWise CLI 实时源", "Python、ADB、设备映射和模型配置已通过专项检查");
  }
  const failing = orderwiseDoctor.checks
    .filter((check) => check.status !== "pass")
    .map((check) => [check.label, check.message].filter(Boolean).join(": "))
    .join("; ");
  if (source.enabled === false) {
    return warn(
      "external-source:orderwiseCli",
      "OrderWise CLI 实时源",
      "OrderWise CLI 尚未 ready；配置前需要先补齐设备和模型",
      failing || undefined
    );
  }
  return fail(
    "external-source:orderwiseCli",
    "OrderWise CLI 实时源",
    "OrderWise CLI 已启用但专项检查未通过；实时 App 查价会失败",
    failing || undefined
  );
}

function checkCalibrationReport(report: CaptureCalibrationReport): LiveReadinessCheck {
  const detailPrefix = `生成时间: ${report.generatedAt}`;
  if (report.status === "pass") {
    return pass("calibration-report", "批量校准报告", "上次批量校准已通过", detailPrefix);
  }

  const failures = report.results
    .filter((result) => result.status === "fail")
    .map((result) => `${result.source}: ${result.error ?? "unknown error"}`)
    .join("; ");
  return warn(
    "calibration-report",
    "批量校准报告",
    "上次批量校准有失败项",
    [detailPrefix, failures].filter(Boolean).join(" - ")
  );
}

function checkSourceConfig(
  source: BrowserPlatformSource,
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

function checkSourceUrl(source: BrowserPlatformSource, entryUrl: string): LiveReadinessCheck {
  if (isPlaceholderUrl(entryUrl)) {
    return fail(
      `source-${source}-url`,
      `${source} 入口 URL`,
      "仍是 example.com 占位入口 URL",
      `运行 ${captureWithSaveUrlCommand(source)}，把 <real-platform-url> 换成真实平台搜索或店铺入口`
    );
  }
  if (/^https?:\/\//i.test(entryUrl)) {
    return pass(`source-${source}-url`, `${source} 入口 URL`, "入口 URL 已设置为网页地址");
  }
  return fail(`source-${source}-url`, `${source} 入口 URL`, "入口 URL 不是 http/https 网页地址");
}

function checkSourceAudit(
  source: BrowserPlatformSource,
  audit: BrowserSourceSelectorAudit | null | undefined,
  networkLog: BrowserNetworkLogEntry[] | null | undefined
): LiveReadinessCheck {
  if (!audit) {
    return fail(
      `source-${source}-audit`,
      `${source} selector 诊断`,
      "缺少 selector audit 文件",
      `运行 ${captureAuditCommand(source)}`
    );
  }

  const statusHits = Object.entries(audit.statusMatches).filter(([, count]) => count > 0);
  if (statusHits.length > 0) {
    return fail(
      `source-${source}-audit`,
      `${source} selector 诊断`,
      `页面命中不可报价状态: ${statusHits.map(([name]) => name).join(", ")}`,
      summarizeNetworkFailures(networkLog)
    );
  }

  if (audit.offerRows.count === 0) {
    return fail(
      `source-${source}-audit`,
      `${source} selector 诊断`,
      "offerRows 没有命中任何候选行",
      summarizeNetworkFailures(networkLog)
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

function summarizeNetworkFailures(
  networkLog: BrowserNetworkLogEntry[] | null | undefined
): string | undefined {
  const failures = (networkLog ?? []).filter(
    (entry) => entry.event === "requestfailed" || (entry.status ?? 0) >= 400
  );
  if (failures.length === 0) {
    return undefined;
  }
  const preview = failures
    .slice(0, 3)
    .map((entry) => {
      if (entry.event === "requestfailed") {
        return `requestfailed ${entry.failureText ?? "unknown"} ${entry.method} ${entry.url}`;
      }
      const status = [entry.status, entry.statusText].filter(Boolean).join(" ");
      return `${status} ${entry.method} ${entry.url}`;
    })
    .join("; ");
  return `网络异常 ${failures.length} 条: ${preview}`;
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

function captureWithSaveUrlCommand(source: BrowserPlatformSource): string {
  return `npm run capture -- "查公司附近冰美式" --source ${source} --url "<real-platform-url>" --save-url --manual-ms 120000`;
}

function captureAuditCommand(source: BrowserPlatformSource): string {
  return `npm run capture -- "查公司附近冰美式" --source ${source} --manual-ms 120000`;
}

function buildLiveReadinessActions(input: BuildLiveReadinessReportInput): LiveReadinessAction[] {
  const actions: LiveReadinessAction[] = [];

  actions.push(...buildExternalSourceActions(input.config, input.luckinDoctor, input.orderwiseDoctor));

  for (const check of input.doctor?.checks ?? []) {
    if (check.status !== "fail") {
      continue;
    }
    if (check.id === "weixin-login") {
      actions.push({
        id: "weixin-login",
        label: "完成微信扫码登录",
        reason: check.message,
        command: "npm run weixin:login -- --open-qr --qr-url-file .runtime/weixin-login/qr-url.txt --qr-html-file .runtime/weixin-login/qr.html"
      });
      continue;
    }
    actions.push({
      id: `doctor:${check.id}`,
      label: `修复 ${check.label}`,
      reason: [check.message, check.detail].filter(Boolean).join(" - "),
      command: "npm run doctor"
    });
  }

  const placeholderSources = SOURCE_KEYS.filter((source) => {
    const spec = input.config.sources[source] ? input.config.browserSources?.[source] : undefined;
    return spec ? isPlaceholderUrl(spec.entryUrl) : false;
  });

  for (const source of SOURCE_KEYS) {
    if (!input.config.sources[source]) {
      continue;
    }
    const spec = input.config.browserSources?.[source];
    if (!spec) {
      actions.push({
        id: `scaffold-source:${source}`,
        label: `${source} 补齐 browserSources 配置`,
        reason: "该渠道已启用，但还没有 browserSources 配置",
        command: "npm run config:scaffold",
        source
      });
    }
  }

  if (placeholderSources.length >= 2) {
    actions.push({
      id: "batch-calibrate",
      label: "批量写入真实平台 URL",
      reason: "多个启用渠道仍是 example.com 占位 URL",
      command: buildBatchCalibrationCommandForSources(placeholderSources)
    });
  } else {
    for (const source of placeholderSources) {
      actions.push({
        id: `replace-source-url:${source}`,
        label: `${source} 替换真实平台 URL`,
        reason: "先把占位 URL 改成真实搜索或店铺入口，再做 selector audit",
        command: captureWithSaveUrlCommand(source),
        source
      });
    }
  }

  const placeholderSourceSet = new Set<BrowserPlatformSource>(placeholderSources);
  for (const source of SOURCE_KEYS) {
    if (!input.config.sources[source] || !input.config.browserSources?.[source]) {
      continue;
    }
    if (placeholderSourceSet.has(source)) {
      continue;
    }
    const audit = input.audits?.[source];
    if (isAuditReady(audit)) {
      continue;
    }
    actions.push({
      id: `capture-audit:${source}`,
      label: `${source} 捕获 selector audit`,
      reason: "入口 URL 已是真实网页，需要用独立 profile 生成 selector audit",
      command: captureAuditCommand(source),
      source
    });
  }

  return actions;
}

function buildExternalSourceActions(
  config: CoffeePriceConfig,
  luckinDoctor: LuckinDoctorReport | null | undefined,
  orderwiseDoctor: OrderWiseDoctorReport | null | undefined
): LiveReadinessAction[] {
  const externalSources = config.externalSources ?? [];
  if (externalSources.length === 0) {
    return [];
  }
  const actions: LiveReadinessAction[] = [];
  const allDisabled = externalSources.every((source) => source.enabled === false);
  const hasDisabledOrderWiseCli = externalSources.some((source) => source.id === "orderwiseCli" && source.enabled === false);
  const hasDisabledOrderWiseMcp = externalSources.some((source) => source.id === "orderwiseMcp" && source.enabled === false);

  if (
    luckinDoctor &&
    luckinDoctor.status !== "pass" &&
    externalSources.some((source) => source.id === "luckinMcp" && source.enabled !== false)
  ) {
    actions.push({
      id: "configure-external-source:luckinMcp",
      label: "配置瑞幸官方 CLI 自取实时源",
      reason: `瑞幸实时源已启用但专项检查未通过；可在微信私聊发送“${LUCKIN_WECHAT_TOKEN_BIND_COMMAND}”，或运行官方 CLI 登录并确认 token；如果网页授权没有自动落盘，复制开放平台 token 后运行 npm run luckin:official-login -- --from-clipboard`,
      command: "npm run luckin:official-login"
    });
  }

  const orderwiseAction = buildOrderWiseCliAction(orderwiseDoctor);
  if (hasDisabledOrderWiseCli) {
    actions.push({
      ...orderwiseAction,
      id: orderwiseAction.id,
      label: orderwiseAction.label,
      reason: orderwiseAction.reason,
      command: orderwiseAction.command
    });
  } else if (hasDisabledOrderWiseMcp) {
    actions.push({
      id: "configure-external-source:orderwiseMcp",
      label: "配置 OrderWise 多平台 MCP 实时源",
      reason: "已有 OrderWise MCP 源配置但仍未启用；可先用已授权 ADB 设备自动映射美团，作为第一条外卖实时源",
      command: "$env:PHONE_AGENT_API_KEY = \"<phone-agent-api-key>\"; npm run orderwise:configure -- --auto-adb --source-apps \"美团\" --orderwise-model-url \"<model-base-url>\" --orderwise-model-name \"<model-name>\" --phone-agent-api-key-env PHONE_AGENT_API_KEY --enable-source"
    });
  }

  if (!allDisabled && actions.length === 0) {
    return actions;
  }

  if (externalSources.some((source) => source.id === "luckinMcp" && source.enabled === false)) {
    actions.push({
      id: "configure-external-source:luckinMcp",
      label: "配置瑞幸官方 CLI 自取实时源",
      reason: `已有瑞幸实时源配置，但仍未启用；可在微信私聊发送“${LUCKIN_WECHAT_TOKEN_BIND_COMMAND}”，或运行 npm run luckin:official-login 登录并启用 source；如果网页授权没有自动落盘，复制开放平台 token 后运行 npm run luckin:official-login -- --from-clipboard`,
      command: "npm run luckin:official-login"
    });
  }
  if (externalSources.some((source) => source.id === "meituanApp" && source.enabled === false)) {
    actions.push({
      id: "configure-external-source:meituanApp",
      label: "检查美团 App 自动化实时源",
      reason: "已有美团 App 自动化源配置，但仍未启用；需要连接已登录美团的 Android 设备或云手机",
      command: "npm run meituan:doctor"
    });
  }
  return actions;
}

function buildOrderWiseCliAction(orderwiseDoctor: OrderWiseDoctorReport | null | undefined): LiveReadinessAction {
  const adbCheck = orderwiseDoctor?.checks.find((check) => check.id === "adb" && check.status !== "pass");
  if (adbCheck) {
    const adbPath = extractDoctorDetailValue(adbCheck.detail, "adb");
    const command = adbPath
      ? `$env:PHONE_AGENT_API_KEY = "<phone-agent-api-key>"; npm run orderwise:configure -- --source-kind cli --connect-adb --adb "${adbPath}" --meituan "<cloud-phone-host:port>" --source-apps "美团" --orderwise-model-url "<model-base-url>" --orderwise-model-name "<model-name>" --phone-agent-api-key-env PHONE_AGENT_API_KEY --enable-source; npm run orderwise:doctor -- --source-kind cli --adb "${adbPath}"`
      : `winget install --id Google.PlatformTools -e --accept-source-agreements --accept-package-agreements; $env:PHONE_AGENT_API_KEY = "<phone-agent-api-key>"; npm run orderwise:configure -- --source-kind cli --connect-adb --meituan "<cloud-phone-host:port>" --source-apps "美团" --orderwise-model-url "<model-base-url>" --orderwise-model-name "<model-name>" --phone-agent-api-key-env PHONE_AGENT_API_KEY --enable-source; npm run orderwise:doctor -- --source-kind cli`;
    return {
      id: "connect-orderwise-adb-device",
      label: "连接 OrderWise Android/云手机设备",
      reason: [adbCheck.message, adbCheck.detail].filter(Boolean).join(" - "),
      command
    };
  }

  const mappingCheck = orderwiseDoctor?.checks.find((check) => check.id === "device-mapping" && check.status !== "pass");
  const modelCheck = orderwiseDoctor?.checks.find((check) => check.id === "model" && check.status !== "pass");
  return {
    id: "configure-external-source:orderwiseCli",
    label: "配置 OrderWise CLI 直连实时源",
    reason: [
      "已有 OrderWise CLI 直连源配置但仍未启用；可不常驻 MCP server，先用已授权 ADB 设备自动映射美团作为第一条外卖实时源",
      mappingCheck ? `${mappingCheck.label}: ${mappingCheck.message}` : undefined,
      modelCheck ? `${modelCheck.label}: ${modelCheck.message}` : undefined
    ].filter(Boolean).join(" - "),
    command: "$env:PHONE_AGENT_API_KEY = \"<phone-agent-api-key>\"; npm run orderwise:configure -- --source-kind cli --auto-adb --source-apps \"美团\" --orderwise-model-url \"<model-base-url>\" --orderwise-model-name \"<model-name>\" --phone-agent-api-key-env PHONE_AGENT_API_KEY --enable-source"
  };
}

function extractDoctorDetailValue(detail: string | undefined, key: string): string | undefined {
  return detail
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${key}=`))
    ?.slice(key.length + 1);
}

function isAuditReady(audit: BrowserSourceSelectorAudit | null | undefined): boolean {
  if (!audit) {
    return false;
  }
  if (Object.values(audit.statusMatches).some((count) => count > 0)) {
    return false;
  }
  if (audit.offerRows.count === 0) {
    return false;
  }
  return audit.rows.every((row) => row.missingRequiredFields.length === 0);
}

function isPlaceholderUrl(entryUrl: string): boolean {
  return /^https?:\/\/example\.com(?:[/:?#]|$)/i.test(entryUrl);
}

function buildBatchCalibrationCommandForSources(sources: readonly BrowserPlatformSource[]): string {
  const urlArgs = sources
    .map((source) => `${urlFlag(source)} "<real-${sourceLabel(source)}-url>"`)
    .join(" ");
  return `npm run capture:calibrate -- "查公司附近冰美式" ${urlArgs} --manual-ms 120000`;
}

function urlFlag(source: BrowserPlatformSource): string {
  return source === "brandOfficial" ? "--url-brand" : `--url-${source}`;
}

function sourceLabel(source: BrowserPlatformSource): string {
  return source === "brandOfficial" ? "brand" : source;
}
