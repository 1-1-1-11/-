import { readFile, writeFile } from "node:fs/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { normalizeConfig } from "./config.js";
import { ExternalCommandProvider } from "./providers/external-command-provider.js";
import { parseCoffeeCommand } from "./query-parser.js";
import type { CoffeePriceConfig, ExternalSourceConfig, OfferCandidate, ProviderStatus } from "./types.js";

export type GenericMcpSetupStatus = "pass" | "warn" | "fail";

export interface GenericMcpSetupOptions {
  configPath: string;
  id: string;
  label: string;
  endpoint: string;
  transport: "http" | "stdio";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envFrom?: Record<string, string>;
  toolName: string;
  toolArguments?: Record<string, unknown>;
  toolResultPath?: string;
  timeoutMs: number;
  bearerTokenEnv?: string;
  bearerTokenFile?: string;
  tokenEnvName?: string;
  dryRun: boolean;
  probeCall: boolean;
  sampleMessage: string;
  addressAlias?: string;
  json: boolean;
}

export interface GenericMcpSetupCheck {
  id: string;
  label: string;
  status: GenericMcpSetupStatus;
  message: string;
  detail?: string;
}

export interface GenericMcpSetupResult {
  status: GenericMcpSetupStatus;
  configPath: string;
  changed: boolean;
  dryRun: boolean;
  source: ExternalSourceConfig;
  checks: GenericMcpSetupCheck[];
}

export interface GenericMcpSetupDeps {
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile?: (path: string, content: string, encoding: BufferEncoding) => Promise<void>;
  listTools?: (source: ExternalSourceConfig) => Promise<string[]>;
  probeSource?: (
    source: ExternalSourceConfig,
    config: CoffeePriceConfig,
    sampleMessage: string,
    addressAlias?: string
  ) => Promise<OfferCandidate[] | ProviderStatus>;
}

const DEFAULT_TOOL_ARGUMENTS: Record<string, unknown> = {
  message: "{{query.rawText}}",
  drink: "{{query.drink}}",
  normalizedDrink: "{{query.normalizedDrink}}",
  size: "{{query.size}}",
  quantity: "{{query.quantity}}",
  address: "{{address.query}}"
};

export function parseGenericMcpSetupArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): GenericMcpSetupOptions {
  const options: GenericMcpSetupOptions = {
    configPath: "config/coffee-price.config.json",
    id: "genericMcp",
    label: "通用 MCP 直连查价源",
    transport: env.COFFEE_PRICE_MCP_TRANSPORT === "stdio" ? "stdio" : "http",
    endpoint: env.COFFEE_PRICE_MCP_URL ?? "",
    command: env.COFFEE_PRICE_MCP_COMMAND,
    args: parseJsonStringArray(env.COFFEE_PRICE_MCP_ARGS),
    env: parseJsonObjectEnv(env.COFFEE_PRICE_MCP_CHILD_ENV),
    envFrom: parseJsonStringRecord(env.COFFEE_PRICE_MCP_ENV_FROM),
    toolName: env.COFFEE_PRICE_MCP_TOOL ?? "coffee_price_search",
    toolResultPath: "snapshot",
    timeoutMs: 120_000,
    bearerTokenEnv: env.COFFEE_PRICE_MCP_TOKEN_ENV,
    bearerTokenFile: env.COFFEE_PRICE_MCP_TOKEN_FILE,
    tokenEnvName: env.COFFEE_PRICE_MCP_TOKEN_ENV_NAME,
    dryRun: args.includes("--dry-run"),
    probeCall: !args.includes("--skip-probe-call"),
    sampleMessage: "查公司附近冰美式",
    json: args.includes("--json")
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--config") {
      options.configPath = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--id") {
      options.id = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--label") {
      options.label = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--endpoint") {
      options.endpoint = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--transport") {
      options.transport = parseTransport(requireValue(arg, next));
      index += 1;
      continue;
    }
    if (arg === "--command") {
      options.command = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--args-json") {
      options.args = parseJsonStringArray(requireValue(arg, next)) ?? [];
      index += 1;
      continue;
    }
    if (arg === "--env-json") {
      options.env = parseRequiredJsonStringRecord(arg, requireValue(arg, next));
      index += 1;
      continue;
    }
    if (arg === "--env-from-json") {
      options.envFrom = parseRequiredJsonStringRecord(arg, requireValue(arg, next));
      index += 1;
      continue;
    }
    if (arg === "--tool" || arg === "--tool-name") {
      options.toolName = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--tool-result-path") {
      options.toolResultPath = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--no-tool-result-path") {
      options.toolResultPath = undefined;
      continue;
    }
    if (arg === "--tool-args-json") {
      options.toolArguments = parseJsonObject(arg, requireValue(arg, next));
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = parsePositiveInteger(arg, requireValue(arg, next));
      index += 1;
      continue;
    }
    if (arg === "--bearer-token-env") {
      options.bearerTokenEnv = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--bearer-token-file") {
      options.bearerTokenFile = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--token-env-name") {
      options.tokenEnvName = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--sample") {
      options.sampleMessage = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--address") {
      options.addressAlias = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--probe-call") {
      options.probeCall = true;
      continue;
    }
    if (arg === "--skip-probe-call") {
      options.probeCall = false;
    }
  }

  if (options.transport === "http" && !options.endpoint) {
    throw new Error("缺少 MCP endpoint；请传 --endpoint 或设置 COFFEE_PRICE_MCP_URL");
  }
  if (options.transport === "stdio" && !options.command) {
    throw new Error("缺少 stdio MCP command；请传 --command 或设置 COFFEE_PRICE_MCP_COMMAND");
  }
  if (!options.toolName) {
    throw new Error("缺少 MCP tool 名称；请传 --tool 或设置 COFFEE_PRICE_MCP_TOOL");
  }
  return options;
}

export async function runGenericMcpSetupCli(
  args: string[],
  deps: GenericMcpSetupDeps = {}
): Promise<{ text: string; exitCode: number; result: GenericMcpSetupResult }> {
  const options = parseGenericMcpSetupArgs(args);
  const result = await setupGenericMcpSource(options, deps);
  return {
    text: options.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatGenericMcpSetupResult(result)}\n`,
    exitCode: result.status === "fail" ? 1 : 0,
    result
  };
}

export async function setupGenericMcpSource(
  options: GenericMcpSetupOptions,
  deps: GenericMcpSetupDeps = {}
): Promise<GenericMcpSetupResult> {
  const source = buildSource(options);
  const checks: GenericMcpSetupCheck[] = [];
  const reader = deps.readFile ?? readFile;
  const writer = deps.writeFile ?? writeFile;

  let config: CoffeePriceConfig | undefined;
  try {
    config = normalizeConfig(JSON.parse(stripJsonBom(await reader(options.configPath, "utf8"))) as Partial<CoffeePriceConfig>);
    checks.push(pass("config", "本地配置", `已读取 ${options.configPath}`));
  } catch (error) {
    checks.push(fail("config", "本地配置", "无法读取本地配置", errorMessage(error)));
  }

  const toolCheck = await checkTool(source, deps);
  checks.push(toolCheck);

  if (options.probeCall && config && toolCheck.status !== "fail") {
    checks.push(await checkProbeCall(source, config, options, deps));
  } else if (!options.probeCall) {
    checks.push(warn("probe-call", "样例试调", "未执行样例调用；只验证了 MCP 入口和 tool 名称", "加 --probe-call 可验证 tool 是否返回统一 PlatformSnapshot"));
  }

  const status = summarize(checks);
  let changed = false;
  if (status !== "fail") {
    const rawConfig = JSON.parse(stripJsonBom(await reader(options.configPath, "utf8"))) as Partial<CoffeePriceConfig>;
    const before = JSON.stringify(rawConfig.externalSources ?? []);
    rawConfig.externalSources = upsertSource(rawConfig.externalSources, source);
    changed = JSON.stringify(rawConfig.externalSources ?? []) !== before;
    if (!options.dryRun && changed) {
      await writer(options.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`, "utf8");
    }
  }

  return {
    status,
    configPath: options.configPath,
    changed,
    dryRun: options.dryRun,
    source,
    checks
  };
}

export function formatGenericMcpSetupResult(result: GenericMcpSetupResult): string {
  const lines = [`通用 MCP 查价源设置`, `总体: ${result.status.toUpperCase()}`];
  for (const check of result.checks) {
    lines.push(`- [${check.status.toUpperCase()}] ${check.label}: ${check.message}`);
    if (check.detail) {
      lines.push(`  ${check.detail}`);
    }
  }
  if (result.status !== "fail") {
    const writeAction = result.dryRun
      ? result.changed
        ? "将写入"
        : "配置无需修改"
      : result.changed
        ? "已写入"
        : "配置无需修改";
    lines.push(
      "",
      `${writeAction}: ${result.configPath}`,
      `外部源: ${formatSourceTarget(result.source)} (${result.source.toolName})`
    );
  }
  return lines.join("\n");
}

async function checkTool(
  source: ExternalSourceConfig,
  deps: GenericMcpSetupDeps
): Promise<GenericMcpSetupCheck> {
  try {
    const tools = await (deps.listTools ?? listMcpTools)(source);
    if (tools.includes(source.toolName ?? "")) {
      return pass("mcp-tool", "MCP tool", `发现 ${source.toolName}`);
    }
    return fail("mcp-tool", "MCP tool", `未发现 ${source.toolName}`, tools.length ? tools.join(", ") : "MCP 入口没有返回 tools");
  } catch (error) {
    return fail("mcp-tool", "MCP 入口", "无法连接或列出 tools", errorMessage(error));
  }
}

async function checkProbeCall(
  source: ExternalSourceConfig,
  config: CoffeePriceConfig,
  options: GenericMcpSetupOptions,
  deps: GenericMcpSetupDeps
): Promise<GenericMcpSetupCheck> {
  const result = await (deps.probeSource ?? probeSource)(source, config, options.sampleMessage, options.addressAlias);
  if (Array.isArray(result) && result.length > 0) {
    const cheapest = [...result].sort((left, right) => offerTotal(left) - offerTotal(right))[0];
    return pass(
      "probe-call",
      "样例试调",
      `返回 ${result.length} 个可比报价`,
      `${cheapest.brand}｜${cheapest.drinkName}｜￥${offerTotal(cheapest).toFixed(2)}`
    );
  }
  if (!Array.isArray(result)) {
    return fail("probe-call", "样例试调", "MCP 返回了状态而不是可比报价", result.message);
  }
  return fail("probe-call", "样例试调", "MCP 没有返回可比报价");
}

async function probeSource(
  source: ExternalSourceConfig,
  config: CoffeePriceConfig,
  sampleMessage: string,
  addressAlias?: string
): Promise<OfferCandidate[] | ProviderStatus> {
  const query = parseCoffeeCommand(sampleMessage);
  const alias = addressAlias ?? query.addressAlias ?? config.defaultAddressAlias;
  const address = config.addresses.find((entry) => entry.alias === alias) ?? config.addresses[0];
  if (!address) {
    return { status: "unavailable", message: "配置里没有可用于样例试调的地址" };
  }
  return new ExternalCommandProvider(source).search({ query, config, address });
}

async function listMcpTools(source: ExternalSourceConfig): Promise<string[]> {
  const client = new Client({
    name: `coffee-price-${source.id}-setup`,
    version: "0.1.0"
  });
  const transport = await createMcpTransport(source);
  try {
    await client.connect(transport);
    const result = await client.listTools();
    return result.tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

async function createMcpTransport(source: ExternalSourceConfig): Promise<Transport> {
  if (source.transport === "stdio") {
    if (!source.command) {
      throw new Error("stdio mcp source.command missing");
    }
    return new StdioClientTransport({
      command: source.command,
      args: source.args ?? [],
      cwd: source.cwd,
      stderr: "pipe",
      env: await buildStdioEnv(source)
    });
  }
  if (!source.endpoint) {
    throw new Error("http mcp source.endpoint missing");
  }
  return new StreamableHTTPClientTransport(new URL(source.endpoint), {
    requestInit: {
      headers: await buildHeaders(source)
    }
  });
}

async function buildHeaders(source: ExternalSourceConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    ...(source.headers ?? {})
  };
  for (const [header, envName] of Object.entries(source.headerEnv ?? {})) {
    const value = process.env[envName];
    if (value) {
      headers[header] = value;
    }
  }
  if (source.bearerTokenEnv && process.env[source.bearerTokenEnv]) {
    headers.authorization = `Bearer ${process.env[source.bearerTokenEnv]!.trim()}`;
  }
  if (source.bearerTokenFile) {
    try {
      const token = (await readFile(source.bearerTokenFile, "utf8")).trim();
      if (token) {
        headers.authorization = `Bearer ${token}`;
      }
    } catch {
      // The setup report will surface auth failures when the endpoint is probed.
    }
  }
  return headers;
}

async function buildStdioEnv(source: ExternalSourceConfig): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    ...getDefaultEnvironment(),
    ...(source.env ?? {})
  };
  for (const [childName, parentName] of Object.entries(source.envFrom ?? {})) {
    const value = process.env[parentName];
    if (value !== undefined) {
      env[childName] = value;
    }
  }
  const token = await readBearerTokenForSetup(source);
  if (token) {
    env[source.tokenEnvName ?? source.bearerTokenEnv ?? "BEARER_TOKEN"] = token;
  }
  return env;
}

async function readBearerTokenForSetup(source: ExternalSourceConfig): Promise<string | null> {
  if (source.bearerTokenEnv && process.env[source.bearerTokenEnv]) {
    return process.env[source.bearerTokenEnv]!.trim();
  }
  if (!source.bearerTokenFile) {
    return null;
  }
  try {
    return (await readFile(source.bearerTokenFile, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

function buildSource(options: GenericMcpSetupOptions): ExternalSourceConfig {
  return {
    id: options.id,
    label: options.label,
    enabled: true,
    type: "mcp",
    transport: options.transport,
    endpoint: options.transport === "http" ? options.endpoint : undefined,
    command: options.transport === "stdio" ? options.command : undefined,
    args: options.transport === "stdio" ? options.args ?? [] : undefined,
    env: options.transport === "stdio" ? options.env : undefined,
    envFrom: options.transport === "stdio" ? options.envFrom : undefined,
    toolName: options.toolName,
    toolArguments: options.toolArguments ?? DEFAULT_TOOL_ARGUMENTS,
    toolResultPath: options.toolResultPath,
    timeoutMs: options.timeoutMs,
    bearerTokenEnv: options.bearerTokenEnv,
    bearerTokenFile: options.bearerTokenFile,
    tokenEnvName: options.tokenEnvName
  };
}

function formatSourceTarget(source: ExternalSourceConfig): string {
  if (source.transport === "stdio") {
    return `${source.id} -> ${[source.command, ...(source.args ?? [])].filter(Boolean).join(" ")}`;
  }
  return `${source.id} -> ${source.endpoint}`;
}

function offerTotal(offer: OfferCandidate): number {
  return offer.totalPrice ?? offer.itemPrice;
}

function upsertSource(
  externalSources: ExternalSourceConfig[] | undefined,
  source: ExternalSourceConfig
): ExternalSourceConfig[] {
  const sources = [...(externalSources ?? [])];
  const index = sources.findIndex((entry) => entry.id === source.id);
  if (index === -1) {
    return [...sources, source];
  }
  sources[index] = {
    ...sources[index],
    ...source,
    enabled: true
  };
  return sources;
}

function summarize(checks: GenericMcpSetupCheck[]): GenericMcpSetupStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

function pass(id: string, label: string, message: string, detail?: string): GenericMcpSetupCheck {
  return { id, label, status: "pass", message, detail };
}

function warn(id: string, label: string, message: string, detail?: string): GenericMcpSetupCheck {
  return { id, label, status: "warn", message, detail };
}

function fail(id: string, label: string, message: string, detail?: string): GenericMcpSetupCheck {
  return { id, label, status: "fail", message, detail };
}

function parseJsonObject(flag: string, value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${flag} 必须是 JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function parseJsonObjectEnv(value: string | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  return parseJsonStringRecord(value);
}

function parseJsonStringRecord(value: string | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return parseRequiredJsonStringRecord("JSON", value);
  } catch {
    return undefined;
  }
}

function parseRequiredJsonStringRecord(flag: string, value: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${flag} 必须是 JSON object`);
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([, entry]) => typeof entry !== "string")) {
    throw new Error(`${flag} 的值必须都是字符串`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseJsonStringArray(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error("MCP args 必须是 JSON 字符串数组");
  }
  return parsed;
}

function parseTransport(value: string): "http" | "stdio" {
  if (value === "http" || value === "stdio") {
    return value;
  }
  throw new Error("--transport 只能是 http 或 stdio");
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stripJsonBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}
