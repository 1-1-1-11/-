import { readFile } from "node:fs/promises";

import { readConfig } from "./config.js";
import { parseLuckinMcpSourceArgs, resolveLuckinToken } from "./luckin-mcp-source.js";
import type { CoffeePriceConfig, ExternalSourceConfig } from "./types.js";

export type LuckinDoctorStatus = "pass" | "warn" | "fail";

export interface LuckinDoctorCheck {
  id: string;
  label: string;
  status: LuckinDoctorStatus;
  message: string;
  detail?: string;
}

export interface LuckinDoctorReport {
  status: LuckinDoctorStatus;
  checks: LuckinDoctorCheck[];
}

export interface LuckinDoctorOptions {
  configPath: string;
  json: boolean;
}

export interface LuckinDoctorDeps {
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  readConfig?: (path: string) => Promise<CoffeePriceConfig>;
}

export function parseLuckinDoctorArgs(args: string[]): LuckinDoctorOptions {
  const options: LuckinDoctorOptions = {
    configPath: "config/coffee-price.config.json",
    json: args.includes("--json")
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--config") {
      if (!next) {
        throw new Error("--config 缺少参数值");
      }
      options.configPath = next;
      index += 1;
    }
  }

  return options;
}

export async function runLuckinDoctorCli(
  args: string[],
  deps: LuckinDoctorDeps = {}
): Promise<{ text: string; exitCode: number; report: LuckinDoctorReport }> {
  const options = parseLuckinDoctorArgs(args);
  const report = await runLuckinDoctor(options, deps);
  return {
    text: options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatLuckinDoctorReport(report)}\n`,
    exitCode: report.status === "fail" ? 1 : 0,
    report
  };
}

export async function runLuckinDoctor(
  options: LuckinDoctorOptions,
  deps: LuckinDoctorDeps = {}
): Promise<LuckinDoctorReport> {
  const checks: LuckinDoctorCheck[] = [];
  let rawConfig: Partial<CoffeePriceConfig> | null = null;
  let config: CoffeePriceConfig | null = null;

  try {
    rawConfig = JSON.parse(stripJsonBom(await (deps.readFile ?? readFile)(options.configPath, "utf8"))) as Partial<CoffeePriceConfig>;
    config = await (deps.readConfig ?? readConfig)(options.configPath);
    checks.push(pass("config", "配置文件", "配置文件可读取并可解析"));
  } catch (error) {
    checks.push(fail("config", "配置文件", "配置文件不可读取或不可解析", String(error instanceof Error ? error.message : error)));
    return report(checks);
  }

  checks.push(await checkToken(deps.env ?? process.env, deps));
  checks.push(checkAddressCoordinates(config));
  checks.push(checkExternalSource(rawConfig.externalSources));
  checks.push(checkEndpoint(deps.env ?? process.env));

  return report(checks);
}

export function formatLuckinDoctorReport(report: LuckinDoctorReport): string {
  const lines = [`瑞幸官方 MCP 源检查`, `总体: ${report.status.toUpperCase()}`];
  for (const check of report.checks) {
    lines.push(`- [${check.status.toUpperCase()}] ${check.label}: ${check.message}`);
    if (check.detail) {
      lines.push(`  ${check.detail}`);
    }
  }
  return lines.join("\n");
}

async function checkToken(env: NodeJS.ProcessEnv, deps: LuckinDoctorDeps): Promise<LuckinDoctorCheck> {
  const sourceOptions = parseLuckinMcpSourceArgs([], env);
  const resolvedToken = await resolveLuckinToken(sourceOptions, deps);
  if (resolvedToken) {
    return pass("token", "瑞幸 token", `已从 ${resolvedToken.source} 读取 token`);
  }
  if (sourceOptions.token?.trim()) {
    const envName = env.LUCKIN_MCP_TOKEN?.trim() ? "LUCKIN_MCP_TOKEN" : "LUCKIN_MCP_ORDER_TOKEN";
    return pass("token", "瑞幸 token", `已从 ${envName} 读取 token`);
  }
  if (!sourceOptions.tokenPath) {
    return fail("token", "瑞幸 token", "未设置 LUCKIN_MCP_TOKEN，也未设置 token 文件路径");
  }
  const reader = deps.readFile ?? readFile;
  try {
    const token = (await reader(sourceOptions.tokenPath, "utf8")).trim();
    if (token) {
      return pass("token", "瑞幸 token", `已从 ${sourceOptions.tokenPath} 读取 token`);
    }
  } catch {
    // Fall through to the actionable failure below.
  }
  return {
    id: "token",
    label: "瑞幸 token",
    status: "fail",
    message: `未检测到 token；请设置 LUCKIN_MCP_TOKEN / LUCKIN_MCP_ORDER_TOKEN，或写入 ${sourceOptions.tokenPath}`,
    detail: "LUCKIN_MCP_ORDER_TOKEN 兼容 aivo-luckin 等公开瑞幸 MCP 工具；token 只应保存在本机环境变量或用户目录文件，不要写入 Git 仓库"
  };
}

function checkAddressCoordinates(config: CoffeePriceConfig): LuckinDoctorCheck {
  const missing = config.addresses.filter(
    (address) => !Number.isFinite(address.longitude) || !Number.isFinite(address.latitude)
  );
  if (!missing.length) {
    return pass("coordinates", "地址经纬度", `所有 ${config.addresses.length} 个地址都有 longitude/latitude`);
  }
  const defaultMissing = missing.some((address) => address.alias === config.defaultAddressAlias);
  return {
    id: "coordinates",
    label: "地址经纬度",
    status: defaultMissing ? "fail" : "warn",
    message: `${missing.length} 个地址缺少 longitude/latitude`,
    detail: missing.map((address) => address.alias).join(", ")
  };
}

function checkExternalSource(externalSources: ExternalSourceConfig[] | undefined): LuckinDoctorCheck {
  const source = externalSources?.find((entry) => entry.id === "luckinMcp");
  if (!source) {
    return fail(
      "external-source",
      "externalSources.luckinMcp",
      "配置里缺少 luckinMcp 外部源",
      "可从 config/coffee-price.config.example.json 复制 luckinMcp 示例块"
    );
  }
  if (source.enabled === false) {
    return warn(
      "external-source",
      "externalSources.luckinMcp",
      "luckinMcp 已配置但未启用",
      "拿到 token 后，把 enabled 改为 true，再运行 npm run pricebook:refresh"
    );
  }
  return pass("external-source", "externalSources.luckinMcp", "luckinMcp 已启用");
}

function checkEndpoint(env: NodeJS.ProcessEnv): LuckinDoctorCheck {
  const sourceOptions = parseLuckinMcpSourceArgs([], env);
  try {
    const url = new URL(sourceOptions.endpoint);
    if (url.protocol !== "https:") {
      return warn("endpoint", "MCP endpoint", "endpoint 不是 https 地址", sourceOptions.endpoint);
    }
    return pass("endpoint", "MCP endpoint", sourceOptions.endpoint);
  } catch {
    return fail("endpoint", "MCP endpoint", "LUCKIN_MCP_URL 不是有效 URL", sourceOptions.endpoint);
  }
}

function stripJsonBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function report(checks: LuckinDoctorCheck[]): LuckinDoctorReport {
  return {
    status: summarize(checks),
    checks
  };
}

function summarize(checks: LuckinDoctorCheck[]): LuckinDoctorStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

function pass(id: string, label: string, message: string, detail?: string): LuckinDoctorCheck {
  return { id, label, status: "pass", message, detail };
}

function warn(id: string, label: string, message: string, detail?: string): LuckinDoctorCheck {
  return { id, label, status: "warn", message, detail };
}

function fail(id: string, label: string, message: string, detail?: string): LuckinDoctorCheck {
  return { id, label, status: "fail", message, detail };
}
