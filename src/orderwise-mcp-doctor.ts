import { readFile } from "node:fs/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { loadOrderWiseEnvFile } from "./orderwise-configure.js";

export type OrderWiseDoctorStatus = "pass" | "warn" | "fail";

export interface OrderWiseDoctorCheck {
  id: string;
  label: string;
  status: OrderWiseDoctorStatus;
  message: string;
  detail?: string;
}

export interface OrderWiseDoctorReport {
  status: OrderWiseDoctorStatus;
  checks: OrderWiseDoctorCheck[];
}

export interface OrderWiseDoctorOptions {
  endpoint: string;
  mappingPath: string;
  envPath: string;
  json: boolean;
}

export interface OrderWiseDoctorDeps {
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  listTools?: (endpoint: string) => Promise<string[]>;
}

const DEFAULT_ENDPOINT = "http://127.0.0.1:8703/mcp";
const DEFAULT_MAPPING_PATH = ".runtime/orderwise-agent/mcp_mode/mcp_server/app_device_mapping.json";

export function parseOrderWiseDoctorArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): OrderWiseDoctorOptions {
  const options: OrderWiseDoctorOptions = {
    endpoint: env.ORDERWISE_MCP_URL ?? DEFAULT_ENDPOINT,
    mappingPath: env.ORDERWISE_DEVICE_MAPPING_FILE ?? DEFAULT_MAPPING_PATH,
    envPath: env.ORDERWISE_ENV_FILE ?? ".runtime/orderwise-agent/.env.local",
    json: args.includes("--json")
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--endpoint") {
      options.endpoint = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--mapping") {
      options.mappingPath = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--env-file") {
      options.envPath = requireValue(arg, next);
      index += 1;
    }
  }

  return options;
}

export async function runOrderWiseDoctorCli(
  args: string[],
  deps: OrderWiseDoctorDeps = {}
): Promise<{ text: string; exitCode: number; report: OrderWiseDoctorReport }> {
  const options = parseOrderWiseDoctorArgs(args, deps.env);
  const report = await runOrderWiseDoctor(options, deps);
  return {
    text: options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatOrderWiseDoctorReport(report)}\n`,
    exitCode: report.status === "fail" ? 1 : 0,
    report
  };
}

export async function runOrderWiseDoctor(
  options: OrderWiseDoctorOptions,
  deps: OrderWiseDoctorDeps = {}
): Promise<OrderWiseDoctorReport> {
  const checks: OrderWiseDoctorCheck[] = [];
  checks.push(await checkMcpEndpoint(options.endpoint, deps));
  checks.push(await checkDeviceMapping(options.mappingPath, deps));
  const effectiveEnv = await loadOrderWiseEnvFile(options.envPath, deps.env ?? process.env, deps.readFile ?? readFile);
  checks.push(checkModelEnv(effectiveEnv));
  return report(checks);
}

export function formatOrderWiseDoctorReport(report: OrderWiseDoctorReport): string {
  const lines = [`OrderWise MCP 源检查`, `总体: ${report.status.toUpperCase()}`];
  for (const check of report.checks) {
    lines.push(`- [${check.status.toUpperCase()}] ${check.label}: ${check.message}`);
    if (check.detail) {
      lines.push(`  ${check.detail}`);
    }
  }
  return lines.join("\n");
}

async function checkMcpEndpoint(endpoint: string, deps: OrderWiseDoctorDeps): Promise<OrderWiseDoctorCheck> {
  try {
    const tools = await (deps.listTools ?? listMcpTools)(endpoint);
    if (tools.includes("compare_prices")) {
      return pass("mcp", "OrderWise MCP", `${endpoint} 已连接，发现 compare_prices 工具`);
    }
    return fail("mcp", "OrderWise MCP", "MCP 已连接但缺少 compare_prices 工具", tools.join(", "));
  } catch (error) {
    return fail(
      "mcp",
      "OrderWise MCP",
      "无法连接 OrderWise MCP 服务",
      [
        "可运行: npm run orderwise:serve",
        error instanceof Error ? error.message : String(error)
      ].join("\n")
    );
  }
}

async function listMcpTools(endpoint: string): Promise<string[]> {
  const client = new Client({
    name: "coffee-price-orderwise-doctor",
    version: "0.1.0"
  });
  try {
    const transport = new StreamableHTTPClientTransport(new URL(endpoint));
    await client.connect(transport);
    const result = await client.listTools();
    return result.tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

async function checkDeviceMapping(
  mappingPath: string,
  deps: OrderWiseDoctorDeps
): Promise<OrderWiseDoctorCheck> {
  try {
    const mapping = JSON.parse(await (deps.readFile ?? readFile)(mappingPath, "utf8")) as Record<string, unknown>;
    const entries = Object.entries(mapping);
    if (!entries.length) {
      return fail("device-mapping", "设备映射", "设备映射文件为空", mappingPath);
    }
    const placeholders = entries.filter(([, value]) => /your-cloud-phone-ip|:port$|device-id/i.test(String(value)));
    if (placeholders.length) {
      return fail(
        "device-mapping",
        "设备映射",
        "设备映射仍是占位值",
        placeholders.map(([key, value]) => `${key}=${value}`).join("\n")
      );
    }
    return pass("device-mapping", "设备映射", `${entries.length} 个 app 已配置设备`, entries.map(([key, value]) => `${key}=${value}`).join("\n"));
  } catch (error) {
    return fail("device-mapping", "设备映射", "无法读取设备映射文件", `${mappingPath}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

function checkModelEnv(env: NodeJS.ProcessEnv): OrderWiseDoctorCheck {
  if (env.PHONE_AGENT_BASE_URL && env.PHONE_AGENT_MODEL) {
    return pass("model", "Phone Agent 模型", `${env.PHONE_AGENT_MODEL} @ ${env.PHONE_AGENT_BASE_URL}`);
  }
  return warn(
    "model",
    "Phone Agent 模型",
    "未设置 PHONE_AGENT_BASE_URL 和 PHONE_AGENT_MODEL，将使用 OrderWise 默认 localhost:4244/v1",
    "如果本机没有 AutoGLM/Phone Agent 模型服务，真实比价会失败"
  );
}

function report(checks: OrderWiseDoctorCheck[]): OrderWiseDoctorReport {
  return {
    status: summarize(checks),
    checks
  };
}

function summarize(checks: OrderWiseDoctorCheck[]): OrderWiseDoctorStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} 缺少参数值`);
  }
  return value;
}

function pass(id: string, label: string, message: string, detail?: string): OrderWiseDoctorCheck {
  return { id, label, status: "pass", message, detail };
}

function warn(id: string, label: string, message: string, detail?: string): OrderWiseDoctorCheck {
  return { id, label, status: "warn", message, detail };
}

function fail(id: string, label: string, message: string, detail?: string): OrderWiseDoctorCheck {
  return { id, label, status: "fail", message, detail };
}
