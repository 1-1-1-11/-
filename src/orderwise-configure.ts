import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";

import type { CoffeePriceConfig, ExternalSourceConfig } from "./types.js";

export interface OrderWiseConfigureOptions {
  mappingPath: string;
  envPath: string;
  configPath: string;
  mapping: Record<string, string>;
  phoneAgentBaseUrl?: string;
  phoneAgentModel?: string;
  orderwiseModelUrl?: string;
  orderwiseModelName?: string;
  phoneAgentApiKey?: string;
  phoneAgentApiKeyEnv?: string;
  phoneAgentMaxSteps?: number;
  autoAdb: boolean;
  connectAdb: boolean;
  adbPath?: string;
  sourceApps?: string[];
  sourceBrands?: string[];
  sourceMaxSteps?: number;
  sourceKind: "mcp" | "cli";
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
  adbConnectAttempts: string[];
  dryRun: boolean;
  text: string;
}

export interface OrderWiseConfigureDeps {
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile?: (path: string, content: string, encoding: BufferEncoding) => Promise<void>;
  mkdir?: (path: string, options: { recursive: true }) => Promise<string | undefined>;
  execFile?: (file: string, args: string[], options?: ExecFileOptions) => Promise<ExecFileResult>;
  env?: NodeJS.ProcessEnv;
}

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

interface ExecFileOptions {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_MAPPING_PATH = ".runtime/orderwise-agent/mcp_mode/mcp_server/app_device_mapping.json";
const DEFAULT_ENV_PATH = ".runtime/orderwise-agent/.env.local";
const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";
const execFileAsync = promisify(execFileCallback);

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

const APP_NAME_TO_KEY: Record<string, string> = {
  "美团": "app1",
  "京东外卖": "app2",
  "淘宝闪购": "app3"
};

const ORDERWISE_APP_KEYS = ["app1", "app2", "app3"];

export function parseOrderWiseConfigureArgs(args: string[]): OrderWiseConfigureOptions {
  const options: OrderWiseConfigureOptions = {
    mappingPath: DEFAULT_MAPPING_PATH,
    envPath: DEFAULT_ENV_PATH,
    configPath: DEFAULT_CONFIG_PATH,
    mapping: {},
    autoAdb: args.includes("--auto-adb"),
    connectAdb: args.includes("--connect-adb"),
    sourceKind: "mcp",
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
      case "--auto-adb":
        options.autoAdb = true;
        break;
      case "--connect-adb":
        options.connectAdb = true;
        break;
      case "--adb":
        options.adbPath = requireValue(arg, next);
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
      case "--orderwise-model-url":
      case "--model-url":
        options.orderwiseModelUrl = requireValue(arg, next);
        index += 1;
        break;
      case "--orderwise-model-name":
      case "--model-name":
        options.orderwiseModelName = requireValue(arg, next);
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
      case "--source-apps":
        options.sourceApps = splitCsv(requireValue(arg, next));
        index += 1;
        break;
      case "--source-brands":
        options.sourceBrands = splitCsv(requireValue(arg, next));
        index += 1;
        break;
      case "--source-max-steps":
        options.sourceMaxSteps = parsePositiveInteger(arg, requireValue(arg, next));
        index += 1;
        break;
      case "--source-kind":
        options.sourceKind = parseSourceKind(requireValue(arg, next));
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
  const env = deps.env ?? process.env;

  const existingMappingObject = await readJsonObject(options.mappingPath, reader);
  const existingMapping = stringifyRecordValues(existingMappingObject);
  const adbConnectAttempts = options.connectAdb && !options.dryRun ? await connectAdbTargets(options, deps, env) : [];
  const autoMapping = options.autoAdb ? await buildAutoAdbMapping(options, deps, env) : {};
  const effectiveMapping = { ...autoMapping, ...options.mapping };
  const nextMapping = buildNextMapping(existingMapping, effectiveMapping);
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
    rawConfig.externalSources = upsertOrderWiseSource(rawConfig.externalSources, options);
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
    adbConnectAttempts,
    text: formatResult(options, { mappingChanged, envChanged, sourceChanged, adbConnectAttempts })
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
  if (merged.ORDERWISE_MODEL_URL && !merged.PHONE_AGENT_BASE_URL) {
    merged.PHONE_AGENT_BASE_URL = merged.ORDERWISE_MODEL_URL;
  }
  if (merged.ORDERWISE_MODEL_NAME && !merged.PHONE_AGENT_MODEL) {
    merged.PHONE_AGENT_MODEL = merged.ORDERWISE_MODEL_NAME;
  }
  const apiKeyEnv = merged.PHONE_AGENT_API_KEY_ENV;
  if (apiKeyEnv && env[apiKeyEnv] && !merged.PHONE_AGENT_API_KEY) {
    merged.PHONE_AGENT_API_KEY = env[apiKeyEnv];
  }
  return merged;
}

function formatResult(
  options: OrderWiseConfigureOptions,
  changes: Pick<OrderWiseConfigureResult, "mappingChanged" | "envChanged" | "sourceChanged" | "adbConnectAttempts">
): string {
  const action = options.dryRun ? "将更新" : "已更新";
  const unchanged = options.dryRun ? "无需更新" : "未变更";
  const sourceId = options.sourceKind === "cli" ? "orderwiseCli" : "orderwiseMcp";
  const lines = ["OrderWise 配置结果"];
  lines.push(`- 设备映射: ${changes.mappingChanged ? action : unchanged} ${options.mappingPath}`);
  lines.push(`- Phone Agent env: ${changes.envChanged ? action : unchanged} ${options.envPath}`);
  if (options.enableSource) {
    lines.push(`- ${sourceId} 外部源: ${changes.sourceChanged ? action : unchanged} ${options.configPath}`);
  }
  if (options.autoAdb) {
    lines.push("提示: 已尝试从 ADB 授权设备自动生成 OrderWise app 映射。");
  }
  if (options.connectAdb) {
    const summary = options.dryRun
      ? "dry-run 未执行 adb connect"
      : changes.adbConnectAttempts.length
      ? changes.adbConnectAttempts.join("; ")
      : "没有发现需要 adb connect 的远程设备地址";
    lines.push(`提示: 已处理 adb connect: ${summary}`);
  }
  if (!Object.keys(options.mapping).length && !options.autoAdb) {
    lines.push("提示: 未传入设备映射；已有映射会被保留。");
  }
  if (options.phoneAgentApiKey) {
    lines.push("提示: API key 已写入本机 .env.local；该路径位于 .runtime 下，不会提交到 Git。");
  } else if (options.phoneAgentApiKeyEnv) {
    lines.push(`提示: serve 会从环境变量 ${options.phoneAgentApiKeyEnv} 读取 PHONE_AGENT_API_KEY。`);
  }
  if (options.orderwiseModelUrl || options.orderwiseModelName) {
    lines.push("提示: ORDERWISE_MODEL_URL/NAME 会自动映射为 OrderWise MCP backend 实际读取的 PHONE_AGENT_BASE_URL/MODEL。");
  }
  if (options.sourceKind === "cli") {
    lines.push("下一步: 运行 npm run orderwise:doctor -- --source-kind cli；OpenClaw 会按需调用 orderwise:cli-source。");
  } else {
    lines.push("下一步: 重启 npm run orderwise:serve，然后运行 npm run orderwise:doctor。");
  }
  return lines.join("\n");
}

async function connectAdbTargets(
  options: OrderWiseConfigureOptions,
  deps: OrderWiseConfigureDeps,
  env: NodeJS.ProcessEnv
): Promise<string[]> {
  const targets = [...new Set(Object.values(options.mapping).filter(isRemoteAdbTarget))];
  if (!targets.length) {
    return [];
  }
  const execFile = deps.execFile ?? execFileText;
  const adbPath = await findUsableAdb(options, deps, env);
  const attempts: string[] = [];
  for (const target of targets) {
    try {
      const result = await execFile(adbPath, ["connect", normalizeAdbTarget(target)], {
        timeout: 15_000,
        env: withAdbPath(env, adbPath)
      });
      const output = `${result.stdout}\n${result.stderr}`.trim();
      if (!/connected|already connected/i.test(output)) {
        throw new Error(output || "adb connect 未返回 connected");
      }
      attempts.push(`${target}: ${firstLine(output) ?? "connected"}`);
    } catch (error) {
      throw new Error(`adb connect ${target} 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return attempts;
}

async function findUsableAdb(
  options: OrderWiseConfigureOptions,
  deps: OrderWiseConfigureDeps,
  env: NodeJS.ProcessEnv
): Promise<string> {
  const execFile = deps.execFile ?? execFileText;
  const errors: string[] = [];
  for (const candidate of getAdbCandidates(options, env)) {
    try {
      await execFile(candidate, ["version"], {
        timeout: 10_000,
        env: withAdbPath(env, candidate)
      });
      return candidate;
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(["未找到可用 adb，无法执行 --connect-adb", ...errors.slice(0, 3)].join("\n"));
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

async function buildAutoAdbMapping(
  options: OrderWiseConfigureOptions,
  deps: OrderWiseConfigureDeps,
  env: NodeJS.ProcessEnv
): Promise<Record<string, string>> {
  const devices = await discoverAdbDevices(options, deps, env);
  if (!devices.length) {
    throw new Error("未检测到可用 ADB 设备；请连接并授权 Android 设备后重试 --auto-adb");
  }
  const appKeys = resolveSourceAppKeys(options.sourceApps);
  return Object.fromEntries(appKeys.map((key, index) => [key, devices[Math.min(index, devices.length - 1)]]));
}

async function discoverAdbDevices(
  options: OrderWiseConfigureOptions,
  deps: OrderWiseConfigureDeps,
  env: NodeJS.ProcessEnv
): Promise<string[]> {
  const execFile = deps.execFile ?? execFileText;
  const errors: string[] = [];
  for (const candidate of getAdbCandidates(options, env)) {
    try {
      const result = await execFile(candidate, ["devices", "-l"], {
        timeout: 10_000,
        env: withAdbPath(env, candidate)
      });
      const devices = parseAdbDevices(result.stdout);
      if (devices.length) {
        return devices;
      }
      errors.push(`${candidate}: 未发现已授权设备`);
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(["未检测到可用 ADB 设备", ...errors.slice(0, 3)].join("\n"));
}

function getAdbCandidates(options: OrderWiseConfigureOptions, env: NodeJS.ProcessEnv): string[] {
  const candidates = [
    options.adbPath,
    env.ORDERWISE_ADB_PATH,
    env.MEITUAN_ADB_PATH,
    platformToolsCandidate(env.ANDROID_HOME),
    platformToolsCandidate(env.ANDROID_SDK_ROOT),
    wingetPlatformToolsCandidate(env),
    "adb"
  ].filter((candidate): candidate is string => Boolean(candidate));
  return [...new Set(candidates)];
}

function platformToolsCandidate(root: string | undefined): string | undefined {
  return root ? join(root, "platform-tools", executableName("adb")) : undefined;
}

function wingetPlatformToolsCandidate(env: NodeJS.ProcessEnv): string | undefined {
  if (!env.LOCALAPPDATA) {
    return undefined;
  }
  return join(
    env.LOCALAPPDATA,
    "Microsoft",
    "WinGet",
    "Packages",
    "Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "platform-tools",
    executableName("adb")
  );
}

function executableName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function withAdbPath(env: NodeJS.ProcessEnv, adbPath: string): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: `${dirname(adbPath)}${delimiter}${env.PATH ?? ""}`,
    Path: `${dirname(adbPath)}${delimiter}${env.Path ?? env.PATH ?? ""}`
  };
}

function parseAdbDevices(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.toLowerCase().startsWith("list of devices"))
    .map((line) => {
      const [serial = "", status = ""] = line.split(/\s+/);
      return status === "device" ? serial : "";
    })
    .filter(Boolean);
}

function isRemoteAdbTarget(value: string): boolean {
  return !isPlaceholderDevice(value) && /^[^:\s]+:\d+$/.test(value);
}

function normalizeAdbTarget(value: string): string {
  return value.includes(":") ? value : `${value}:5555`;
}

function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
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
  if (options.orderwiseModelUrl) {
    entries.ORDERWISE_MODEL_URL = options.orderwiseModelUrl;
    if (!options.phoneAgentBaseUrl) {
      entries.PHONE_AGENT_BASE_URL = options.orderwiseModelUrl;
    }
  }
  if (options.orderwiseModelName) {
    entries.ORDERWISE_MODEL_NAME = options.orderwiseModelName;
    if (!options.phoneAgentModel) {
      entries.PHONE_AGENT_MODEL = options.orderwiseModelName;
    }
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
    "PHONE_AGENT_MAX_STEPS",
    "ORDERWISE_MODEL_URL",
    "ORDERWISE_MODEL_NAME"
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
  externalSources: ExternalSourceConfig[] | undefined,
  options: Pick<OrderWiseConfigureOptions, "sourceApps" | "sourceBrands" | "sourceMaxSteps" | "sourceKind" | "mappingPath" | "adbPath">
): ExternalSourceConfig[] {
  const sourceId = options.sourceKind === "cli" ? "orderwiseCli" : "orderwiseMcp";
  const source: ExternalSourceConfig = {
    id: sourceId,
    label: options.sourceKind === "cli" ? "OrderWise CLI 直连" : "OrderWise 多平台 MCP",
    enabled: true,
    type: "command",
    command: "node",
    args: buildOrderWiseSourceArgs(options),
    timeoutMs: 600000
  };
  const sources = [...(externalSources ?? [])];
  const index = sources.findIndex((entry) => entry.id === source.id);
  if (index === -1) {
    return [...sources, source];
  }
  const existing = sources[index];
  sources[index] = {
    ...source,
    ...existing,
    enabled: true,
    args: shouldRewriteSourceArgs(options) ? buildOrderWiseSourceArgs(options, existing.args) : existing.args ?? source.args
  };
  return sources;
}

function buildOrderWiseSourceArgs(
  options: Pick<OrderWiseConfigureOptions, "sourceApps" | "sourceBrands" | "sourceMaxSteps" | "sourceKind" | "mappingPath" | "adbPath">,
  existingArgs?: string[]
): string[] {
  const args = existingArgs?.length
    ? [...existingArgs]
    : options.sourceKind === "cli"
      ? ["--import", "tsx", "src/orderwise-cli-source-cli.ts", "--mapping", options.mappingPath]
      : ["--import", "tsx", "src/orderwise-mcp-source-cli.ts", "--endpoint", "http://127.0.0.1:8703/mcp"];
  if (options.sourceBrands?.length) {
    setFlag(args, "--brands", options.sourceBrands.join(","));
  }
  if (options.sourceApps?.length) {
    setFlag(args, "--apps", options.sourceApps.join(","));
  }
  if (options.sourceMaxSteps !== undefined) {
    setFlag(args, "--max-steps", String(options.sourceMaxSteps));
  }
  if (options.sourceKind === "cli" && options.adbPath) {
    setFlag(args, "--adb", options.adbPath);
  }
  return args;
}

function shouldRewriteSourceArgs(
  options: Pick<OrderWiseConfigureOptions, "sourceApps" | "sourceBrands" | "sourceMaxSteps" | "sourceKind" | "adbPath">
): boolean {
  return Boolean(options.sourceKind === "cli" || options.sourceApps?.length || options.sourceBrands?.length || options.sourceMaxSteps !== undefined || options.adbPath);
}

function setFlag(args: string[], flag: string, value: string): void {
  const index = args.indexOf(flag);
  if (index === -1) {
    args.push(flag, value);
    return;
  }
  args[index + 1] = value;
}

function parseJsonObject(flag: string, value: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${flag} 必须是 JSON object`);
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, entry]) => [key, String(entry)]));
}

function splitCsv(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseSourceKind(value: string): "mcp" | "cli" {
  if (value === "mcp" || value === "cli") {
    return value;
  }
  throw new Error("--source-kind 必须是 mcp 或 cli");
}

function resolveSourceAppKeys(sourceApps: string[] | undefined): string[] {
  if (!sourceApps?.length) {
    return ORDERWISE_APP_KEYS;
  }
  const keys = sourceApps
    .map((app) => APP_NAME_TO_KEY[app] ?? app)
    .filter((key) => ORDERWISE_APP_KEYS.includes(key));
  return keys.length ? [...new Set(keys)] : ORDERWISE_APP_KEYS;
}

async function execFileText(file: string, args: string[], options: ExecFileOptions = {}): Promise<ExecFileResult> {
  const result = await execFileAsync(file, args, {
    timeout: options.timeout,
    env: options.env,
    encoding: "utf8"
  });
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr)
  };
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
