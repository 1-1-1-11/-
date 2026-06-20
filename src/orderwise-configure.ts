import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CoffeePriceConfig, ExternalSourceConfig } from "./types.js";

export interface OrderWiseConfigureOptions {
  mappingPath: string;
  envPath: string;
  configPath: string;
  mapping: Record<string, string>;
  phoneAgentBaseUrl?: string;
  phoneAgentModel?: string;
  phoneAgentApiKey?: string;
  phoneAgentApiKeyEnv?: string;
  phoneAgentMaxSteps?: number;
  enableSource: boolean;
  dryRun: boolean;
  json: boolean;
}

export interface OrderWiseConfigureResult {
  mappingPath: string;
  envPath: string;
  configPath: string;
  mappingChanged: boolean;
  envChanged: boolean;
  sourceChanged: boolean;
  dryRun: boolean;
  text: string;
}

export interface OrderWiseConfigureDeps {
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile?: (path: string, content: string, encoding: BufferEncoding) => Promise<void>;
  mkdir?: (path: string, options: { recursive: true }) => Promise<string | undefined>;
}

const DEFAULT_MAPPING_PATH = ".runtime/orderwise-agent/mcp_mode/mcp_server/app_device_mapping.json";
const DEFAULT_ENV_PATH = ".runtime/orderwise-agent/.env.local";
const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";

const APP_FLAG_TO_KEY: Record<string, string> = {
  "--app1": "app1",
  "--meituan": "app1",
  "--美团": "app1",
  "--app2": "app2",
  "--jd": "app2",
  "--jingdong": "app2",
  "--京东外卖": "app2",
  "--app3": "app3",
  "--taobao": "app3",
  "--淘宝闪购": "app3"
};

export function parseOrderWiseConfigureArgs(args: string[]): OrderWiseConfigureOptions {
  const options: OrderWiseConfigureOptions = {
    mappingPath: DEFAULT_MAPPING_PATH,
    envPath: DEFAULT_ENV_PATH,
    configPath: DEFAULT_CONFIG_PATH,
    mapping: {},
    enableSource: args.includes("--enable-source"),
    dryRun: args.includes("--dry-run"),
    json: args.includes("--json")
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (APP_FLAG_TO_KEY[arg]) {
      options.mapping[APP_FLAG_TO_KEY[arg]] = requireValue(arg, next);
      index += 1;
      continue;
    }
    switch (arg) {
      case "--mapping":
        options.mappingPath = requireValue(arg, next);
        index += 1;
        break;
      case "--env-file":
        options.envPath = requireValue(arg, next);
        index += 1;
        break;
      case "--config":
        options.configPath = requireValue(arg, next);
        index += 1;
        break;
      case "--device-mapping":
        options.mapping = { ...options.mapping, ...parseJsonObject(arg, requireValue(arg, next)) };
        index += 1;
        break;
      case "--phone-agent-base-url":
        options.phoneAgentBaseUrl = requireValue(arg, next);
        index += 1;
        break;
      case "--phone-agent-model":
        options.phoneAgentModel = requireValue(arg, next);
        index += 1;
        break;
      case "--phone-agent-api-key":
        options.phoneAgentApiKey = requireValue(arg, next);
        index += 1;
        break;
      case "--phone-agent-api-key-env":
        options.phoneAgentApiKeyEnv = requireValue(arg, next);
        index += 1;
        break;
      case "--phone-agent-max-steps":
        options.phoneAgentMaxSteps = parsePositiveInteger(arg, requireValue(arg, next));
        index += 1;
        break;
    }
  }

  return options;
}

export async function runOrderWiseConfigureCli(
  args: string[],
  deps: OrderWiseConfigureDeps = {}
): Promise<{ text: string; exitCode: number; result: OrderWiseConfigureResult }> {
  const options = parseOrderWiseConfigureArgs(args);
  const result = await configureOrderWise(options, deps);
  return {
    text: options.json ? `${JSON.stringify(result, null, 2)}\n` : `${result.text}\n`,
    exitCode: 0,
    result
  };
}

export async function configureOrderWise(
  options: OrderWiseConfigureOptions,
  deps: OrderWiseConfigureDeps = {}
): Promise<OrderWiseConfigureResult> {
  const reader = deps.readFile ?? readFile;
  const writer = deps.writeFile ?? writeFile;
  const makeDir = deps.mkdir ?? mkdir;

  const existingMappingObject = await readJsonObject(options.mappingPath, reader);
  const existingMapping = stringifyRecordValues(existingMappingObject);
  const nextMapping = buildNextMapping(existingMapping, options.mapping);
  const mappingContent = `${JSON.stringify(nextMapping, null, 2)}\n`;
  const mappingChanged = !sameStringRecord(existingMapping, nextMapping);

  const envEntries = await buildEnvEntries(options.envPath, options, reader);
  const envContent = formatEnvFile(envEntries);
  const existingEnv = await readOptional(options.envPath, reader);
  const envChanged = !sameStringRecord(parseEnvFile(existingEnv), envEntries);

  let sourceChanged = false;
  let sourceConfigContent: string | null = null;
  if (options.enableSource) {
    const rawConfig = JSON.parse(stripJsonBom(await reader(options.configPath, "utf8"))) as Partial<CoffeePriceConfig>;
    const before = JSON.stringify(rawConfig.externalSources ?? []);
    rawConfig.externalSources = upsertOrderWiseSource(rawConfig.externalSources);
    sourceChanged = JSON.stringify(rawConfig.externalSources ?? []) !== before;
    sourceConfigContent = `${JSON.stringify(rawConfig, null, 2)}\n`;
  }

  if (!options.dryRun) {
    if (mappingChanged) {
      await makeDir(dirname(options.mappingPath), { recursive: true });
      await writer(options.mappingPath, mappingContent, "utf8");
    }
    if (envChanged) {
      await makeDir(dirname(options.envPath), { recursive: true });
      await writer(options.envPath, envContent, "utf8");
    }
    if (options.enableSource && sourceChanged && sourceConfigContent) {
      await makeDir(dirname(options.configPath), { recursive: true });
      await writer(options.configPath, sourceConfigContent, "utf8");
    }
  }

  return {
    mappingPath: options.mappingPath,
    envPath: options.envPath,
    configPath: options.configPath,
    mappingChanged,
    envChanged,
    sourceChanged,
    dryRun: options.dryRun,
    text: formatResult(options, { mappingChanged, envChanged, sourceChanged })
  };
}

export async function loadOrderWiseEnvFile(
  envPath = DEFAULT_ENV_PATH,
  env: NodeJS.ProcessEnv = process.env,
  reader: (path: string, encoding: BufferEncoding) => Promise<string> = readFile
): Promise<NodeJS.ProcessEnv> {
  const content = await readOptional(envPath, reader);
  if (!content) {
    return env;
  }
  const parsed = parseEnvFile(content);
  const merged: NodeJS.ProcessEnv = { ...env, ...parsed };
  const apiKeyEnv = merged.PHONE_AGENT_API_KEY_ENV;
  if (apiKeyEnv && env[apiKeyEnv] && !merged.PHONE_AGENT_API_KEY) {
    merged.PHONE_AGENT_API_KEY = env[apiKeyEnv];
  }
  return merged;
}

function formatResult(
  options: OrderWiseConfigureOptions,
  changes: Pick<OrderWiseConfigureResult, "mappingChanged" | "envChanged" | "sourceChanged">
): string {
  const action = options.dryRun ? "将更新" : "已更新";
  const unchanged = options.dryRun ? "无需更新" : "未变更";
  const lines = ["OrderWise 配置结果"];
  lines.push(`- 设备映射: ${changes.mappingChanged ? action : unchanged} ${options.mappingPath}`);
  lines.push(`- Phone Agent env: ${changes.envChanged ? action : unchanged} ${options.envPath}`);
  if (options.enableSource) {
    lines.push(`- orderwiseMcp 外部源: ${changes.sourceChanged ? action : unchanged} ${options.configPath}`);
  }
  if (!Object.keys(options.mapping).length) {
    lines.push("提示: 未传入设备映射；已有映射会被保留。");
  }
  if (options.phoneAgentApiKey) {
    lines.push("提示: API key 已写入本机 .env.local；该路径位于 .runtime 下，不会提交到 Git。");
  } else if (options.phoneAgentApiKeyEnv) {
    lines.push(`提示: serve 会从环境变量 ${options.phoneAgentApiKeyEnv} 读取 PHONE_AGENT_API_KEY。`);
  }
  lines.push("下一步: 重启 npm run orderwise:serve，然后运行 npm run orderwise:doctor。");
  return lines.join("\n");
}

function buildNextMapping(
  existing: Record<string, string>,
  mapping: Record<string, string>
): Record<string, string> {
  if (!Object.keys(mapping).length) {
    return existing;
  }
  const sanitized = Object.fromEntries(
    Object.entries(existing).filter(([, value]) => !isPlaceholderDevice(value))
  ) as Record<string, string>;
  return { ...sanitized, ...mapping };
}

async function buildEnvEntries(
  envPath: string,
  options: OrderWiseConfigureOptions,
  reader: (path: string, encoding: BufferEncoding) => Promise<string>
): Promise<Record<string, string>> {
  const entries = parseEnvFile(await readOptional(envPath, reader));
  if (options.phoneAgentBaseUrl) {
    entries.PHONE_AGENT_BASE_URL = options.phoneAgentBaseUrl;
  }
  if (options.phoneAgentModel) {
    entries.PHONE_AGENT_MODEL = options.phoneAgentModel;
  }
  if (options.phoneAgentApiKey) {
    entries.PHONE_AGENT_API_KEY = options.phoneAgentApiKey;
    delete entries.PHONE_AGENT_API_KEY_ENV;
  }
  if (options.phoneAgentApiKeyEnv) {
    entries.PHONE_AGENT_API_KEY_ENV = options.phoneAgentApiKeyEnv;
    delete entries.PHONE_AGENT_API_KEY;
  }
  if (options.phoneAgentMaxSteps !== undefined) {
    entries.PHONE_AGENT_MAX_STEPS = String(options.phoneAgentMaxSteps);
  }
  return entries;
}

function formatEnvFile(entries: Record<string, string>): string {
  const knownKeys = [
    "PHONE_AGENT_BASE_URL",
    "PHONE_AGENT_MODEL",
    "PHONE_AGENT_API_KEY",
    "PHONE_AGENT_API_KEY_ENV",
    "PHONE_AGENT_MAX_STEPS"
  ];
  const keys = [
    ...knownKeys,
    ...Object.keys(entries)
      .filter((key) => !knownKeys.includes(key))
      .sort()
  ];
  const lines = keys
    .filter((key) => entries[key])
    .map((key) => `${key}=${quoteEnv(entries[key])}`);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function stringifyRecordValues(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value)]));
}

function sameStringRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function parseEnvFile(content: string | null): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const rawLine of (content ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = unquoteEnv(line.slice(separator + 1).trim());
    if (key) {
      entries[key] = value;
    }
  }
  return entries;
}

async function readJsonObject(
  path: string,
  reader: (path: string, encoding: BufferEncoding) => Promise<string>
): Promise<Record<string, unknown>> {
  const content = await readOptional(path, reader);
  if (!content) {
    return {};
  }
  const parsed = JSON.parse(stripJsonBom(content)) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

async function readOptional(
  path: string,
  reader: (path: string, encoding: BufferEncoding) => Promise<string>
): Promise<string | null> {
  try {
    return await reader(path, "utf8");
  } catch {
    return null;
  }
}

function upsertOrderWiseSource(
  externalSources: ExternalSourceConfig[] | undefined
): ExternalSourceConfig[] {
  const source: ExternalSourceConfig = {
    id: "orderwiseMcp",
    label: "OrderWise 多平台 MCP",
    enabled: true,
    type: "command",
    command: "node",
    args: ["--import", "tsx", "src/orderwise-mcp-source-cli.ts", "--endpoint", "http://127.0.0.1:8703/mcp"],
    timeoutMs: 600000
  };
  const sources = [...(externalSources ?? [])];
  const index = sources.findIndex((entry) => entry.id === source.id);
  if (index === -1) {
    return [...sources, source];
  }
  sources[index] = {
    ...source,
    ...sources[index],
    enabled: true
  };
  return sources;
}

function parseJsonObject(flag: string, value: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${flag} 必须是 JSON object`);
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, entry]) => [key, String(entry)]));
}

function parsePositiveInteger(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} 必须是正整数`);
  }
  return parsed;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} 缺少参数值`);
  }
  return value;
}

function quoteEnv(value: string): string {
  return JSON.stringify(value);
}

function unquoteEnv(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isPlaceholderDevice(value: string): boolean {
  return /your-cloud-phone-ip|:port$|device-id/i.test(value);
}

function stripJsonBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}
