import { homedir } from "node:os";
import { join } from "node:path";

import { readConfig } from "./config.js";
import { formatLuckinDoctorReport, runLuckinDoctor, type LuckinDoctorReport } from "./luckin-mcp-doctor.js";
import { importLuckinToken } from "./luckin-token-import.js";
import { refreshPriceBook, type PriceBookRefreshSummary } from "./pricebook-refresh.js";
import type { CoffeePriceConfig } from "./types.js";

export interface LuckinSetupOptions {
  configPath: string;
  tokenText?: string;
  tokenPath: string;
  refresh: boolean;
  json: boolean;
  requireLive: boolean;
}

export interface LuckinSetupResult {
  status: "ready" | "degraded" | "blocked";
  importedToken: boolean;
  fallbackSources: string[];
  doctor: LuckinDoctorReport;
  refresh?: PriceBookRefreshSummary;
  refreshError?: string;
  text: string;
}

export interface LuckinSetupDeps {
  readConfig?: (path: string) => Promise<CoffeePriceConfig>;
  importLuckinToken?: typeof importLuckinToken;
  runLuckinDoctor?: typeof runLuckinDoctor;
  refreshPriceBook?: typeof refreshPriceBook;
  now?: () => Date;
}

const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";
const DEFAULT_TOKEN_PATH = join(homedir(), ".my-coffee", "LUCKIN_MCP_TOKEN");

export function parseLuckinSetupArgs(args: string[]): LuckinSetupOptions {
  const options: LuckinSetupOptions = {
    configPath: DEFAULT_CONFIG_PATH,
    tokenPath: DEFAULT_TOKEN_PATH,
    refresh: !args.includes("--skip-refresh") && !args.includes("--no-refresh"),
    json: args.includes("--json"),
    requireLive: args.includes("--require-live")
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--config") {
      options.configPath = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--token") {
      options.tokenText = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--token-file") {
      options.tokenPath = requireValue(arg, next);
      index += 1;
      continue;
    }
  }

  return options;
}

export async function runLuckinSetupCli(
  args: string[],
  deps: LuckinSetupDeps = {}
): Promise<{ text: string; exitCode: number; result: LuckinSetupResult }> {
  const options = parseLuckinSetupArgs(args);
  const result = await setupLuckinMcp(options, deps);
  return {
    text: options.json ? `${JSON.stringify(toJsonResult(result), null, 2)}\n` : `${result.text}\n`,
    exitCode: result.status === "blocked" ? 1 : 0,
    result
  };
}

export async function setupLuckinMcp(
  options: LuckinSetupOptions,
  deps: LuckinSetupDeps = {}
): Promise<LuckinSetupResult> {
  let importedToken = false;
  let importMessage: string | undefined;

  if (options.tokenText?.trim()) {
    const imported = await (deps.importLuckinToken ?? importLuckinToken)({
      tokenText: options.tokenText,
      tokenPath: options.tokenPath,
      configPath: options.configPath,
      enable: true
    });
    importedToken = true;
    importMessage = imported.text;
  }

  const doctor = await (deps.runLuckinDoctor ?? runLuckinDoctor)({
    configPath: options.configPath,
    json: false
  });
  const config = await (deps.readConfig ?? readConfig)(options.configPath);
  const fallbackSources = enabledFallbackSources(config);
  const liveReady = isLiveReady(doctor);

  let refreshSummary: PriceBookRefreshSummary | undefined;
  let refreshError: string | undefined;
  if (liveReady && options.refresh) {
    try {
      refreshSummary = await (deps.refreshPriceBook ?? refreshPriceBook)(
        {
          configPath: options.configPath,
          queries: [],
          outputFormat: "text"
        },
        { now: deps.now }
      );
    } catch (error) {
      refreshError = error instanceof Error ? error.message : String(error);
    }
  }

  const status = decideStatus({
    liveReady,
    refreshError,
    fallbackSources,
    requireLive: options.requireLive
  });
  const text = formatSetupResult({
    status,
    importedToken,
    importMessage,
    fallbackSources,
    doctor,
    refreshSummary,
    refreshError,
    requireLive: options.requireLive
  });

  return {
    status,
    importedToken,
    fallbackSources,
    doctor,
    refresh: refreshSummary,
    refreshError,
    text
  };
}

function enabledFallbackSources(config: CoffeePriceConfig): string[] {
  const sources: string[] = [];
  if (config.sources.priceBook) {
    sources.push("本地价格库");
  }
  if (config.sources.cityBenchmark) {
    sources.push("城市参考价（非实时）");
  }
  return sources;
}

function isLiveReady(report: LuckinDoctorReport): boolean {
  const checks = new Map(report.checks.map((check) => [check.id, check.status]));
  return (
    checks.get("token") === "pass" &&
    checks.get("coordinates") !== "fail" &&
    checks.get("external-source") === "pass" &&
    checks.get("endpoint") !== "fail"
  );
}

function decideStatus(input: {
  liveReady: boolean;
  refreshError?: string;
  fallbackSources: string[];
  requireLive: boolean;
}): LuckinSetupResult["status"] {
  if (input.liveReady && !input.refreshError) {
    return "ready";
  }
  if (input.requireLive) {
    return "blocked";
  }
  return input.fallbackSources.length > 0 ? "degraded" : "blocked";
}

function formatSetupResult(input: {
  status: LuckinSetupResult["status"];
  importedToken: boolean;
  importMessage?: string;
  fallbackSources: string[];
  doctor: LuckinDoctorReport;
  refreshSummary?: PriceBookRefreshSummary;
  refreshError?: string;
  requireLive: boolean;
}): string {
  const lines = [`瑞幸实时源设置结果: ${input.status.toUpperCase()}`];
  if (input.importedToken && input.importMessage) {
    lines.push("", input.importMessage);
  }
  lines.push("", formatLuckinDoctorReport(input.doctor));

  if (input.refreshSummary) {
    lines.push(
      "",
      `价格库刷新成功: ${input.refreshSummary.outputPath}`,
      `刷新条目: ${input.refreshSummary.refreshedOffers}`,
      `保留旧条目: ${input.refreshSummary.retainedOffers}`
    );
  }
  if (input.refreshError) {
    lines.push("", `价格库刷新未完成: ${input.refreshError}`);
  }

  if (input.status === "ready") {
    lines.push("", "可用状态: 微信查价会使用瑞幸官方 CLI 实时自取价，并保留其他已启用来源。");
  } else if (input.status === "degraded") {
    lines.push(
      "",
      `降级可用: 微信查价仍会使用 ${input.fallbackSources.join("、")} 返回可解释结果。`,
      "边界: 瑞幸官方 CLI 实时价需要 token；不会绕过登录、人机验证或平台风控。"
    );
  } else {
    lines.push(
      "",
      input.requireLive
        ? "阻塞原因: 已要求实时源可用，但 token/配置/刷新检查未全部通过。"
        : "阻塞原因: 没有可用实时源，也没有启用本地价格库或城市参考价。"
    );
  }

  return lines.join("\n");
}

function toJsonResult(result: LuckinSetupResult): Omit<LuckinSetupResult, "text"> {
  return {
    status: result.status,
    importedToken: result.importedToken,
    fallbackSources: result.fallbackSources,
    doctor: result.doctor,
    refresh: result.refresh,
    refreshError: result.refreshError
  };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} 缺少参数值`);
  }
  return value;
}
