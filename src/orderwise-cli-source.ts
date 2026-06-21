import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { roundCurrency } from "./pricing.js";
import type { AddressConfig, CoffeeQuery, PlatformSnapshot, PlatformSnapshotOffer } from "./types.js";

interface ExternalPriceSourceRequest {
  query: CoffeeQuery;
  address: AddressConfig;
}

export interface OrderWiseCliSourceOptions {
  pythonPath: string;
  repoPath: string;
  mappingPath: string;
  brands: string[];
  apps: string[];
  maxSteps: number;
  deviceMapping?: Record<string, string>;
}

export interface OrderWiseCliSourceDeps {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  runPython?: (
    options: OrderWiseCliSourceOptions,
    payload: OrderWisePythonPayload
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

interface OrderWisePythonPayload {
  productName: string;
  sellerName: string;
  apps: string[];
  deviceMapping: Record<string, string>;
  maxSteps: number;
}

interface OrderWisePlatformResult {
  app?: string;
  status?: string;
  price?: number | string;
  delivery_fee?: number | string;
  deliveryFee?: number | string;
  pack_fee?: number | string;
  packFee?: number | string;
  packaging_fee?: number | string;
  total_fee?: number | string;
  totalFee?: number | string;
  error?: string;
  duration?: number | string;
}

interface OrderWiseCliResult {
  error?: string;
  best_price?: { app?: string; total_fee?: number | string };
  platform_results?: Record<string, OrderWisePlatformResult>;
}

const DEFAULT_REPO_PATH = ".runtime/orderwise-agent";
const DEFAULT_MAPPING_PATH = ".runtime/orderwise-agent/mcp_mode/mcp_server/app_device_mapping.json";
const DEFAULT_BRANDS = ["瑞幸", "库迪", "星巴克", "Tims", "Manner", "M Stand", "Peet's"];
const DEFAULT_APPS = ["美团", "京东外卖", "淘宝闪购"];
const APP_NAME_TO_KEY: Record<string, string> = {
  "美团": "app1",
  "京东外卖": "app2",
  "淘宝闪购": "app3"
};
const RESULT_MARKER = "__ORDERWISE_CLI_JSON__";

export function parseOrderWiseCliSourceArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): OrderWiseCliSourceOptions {
  const repoPath = env.ORDERWISE_CLI_PATH ?? DEFAULT_REPO_PATH;
  const options: OrderWiseCliSourceOptions = {
    repoPath,
    pythonPath: env.ORDERWISE_PYTHON_PATH ?? defaultPythonPath(repoPath),
    mappingPath: env.ORDERWISE_DEVICE_MAPPING_FILE ?? DEFAULT_MAPPING_PATH,
    brands: splitCsv(env.ORDERWISE_BRANDS) ?? DEFAULT_BRANDS,
    apps: splitCsv(env.ORDERWISE_APPS) ?? DEFAULT_APPS,
    maxSteps: parseOptionalInteger(env.ORDERWISE_MAX_STEPS) ?? 100,
    deviceMapping: parseJsonObject(env.ORDERWISE_DEVICE_MAPPING)
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--repo":
        options.repoPath = requireValue(arg, next);
        options.pythonPath = defaultPythonPath(options.repoPath);
        index += 1;
        break;
      case "--python":
        options.pythonPath = requireValue(arg, next);
        index += 1;
        break;
      case "--mapping":
        options.mappingPath = requireValue(arg, next);
        index += 1;
        break;
      case "--device-mapping":
        options.deviceMapping = parseRequiredJsonObject(arg, next);
        index += 1;
        break;
      case "--brands":
        options.brands = splitCsv(requireValue(arg, next)) ?? DEFAULT_BRANDS;
        index += 1;
        break;
      case "--apps":
        options.apps = splitCsv(requireValue(arg, next)) ?? DEFAULT_APPS;
        index += 1;
        break;
      case "--max-steps":
        options.maxSteps = parseRequiredInteger(arg, next);
        index += 1;
        break;
    }
  }

  return options;
}

export async function runOrderWiseCliSourceCli(
  args: string[],
  deps: OrderWiseCliSourceDeps = {}
): Promise<{ text: string; exitCode: number; snapshot: PlatformSnapshot }> {
  const options = parseOrderWiseCliSourceArgs(args, deps.env);
  const stdin = deps.stdin ?? (await readStdin());
  const request = JSON.parse(stdin) as ExternalPriceSourceRequest;
  const snapshot = await buildOrderWiseCliSnapshot(request, options, deps);
  return {
    text: `${JSON.stringify(snapshot)}\n`,
    exitCode: 0,
    snapshot
  };
}

export async function buildOrderWiseCliSnapshot(
  request: ExternalPriceSourceRequest,
  options: OrderWiseCliSourceOptions,
  deps: OrderWiseCliSourceDeps = {}
): Promise<PlatformSnapshot> {
  const deviceMapping = await resolveDeviceMapping(options, deps);
  const appDeviceMapping = selectAppDeviceMapping(options.apps, deviceMapping);
  if (!Object.keys(appDeviceMapping).length) {
    return {
      source: "orderwiseCli",
      status: "unavailable",
      message: "OrderWise CLI 缺少可用设备映射；请连接并授权云手机或 Android 设备后重新配置"
    };
  }

  const offers: PlatformSnapshotOffer[] = [];
  const failures: string[] = [];
  const productName = buildProductName(request.query);
  const runPython = deps.runPython ?? runOrderWisePython;

  for (const brand of options.brands) {
    try {
      const result = await runPython(options, {
        productName,
        sellerName: brand,
        apps: options.apps,
        deviceMapping: appDeviceMapping,
        maxSteps: options.maxSteps
      });
      if (result.exitCode !== 0) {
        failures.push(`${brand}: ${result.stderr || result.stdout || `OrderWise CLI exit ${result.exitCode}`}`);
        continue;
      }
      const payload = parseOrderWiseJson(result.stdout);
      if (payload.error) {
        failures.push(`${brand}: ${payload.error}`);
        continue;
      }
      const brandOffers = toOffers(brand, productName, payload, request.query);
      if (brandOffers.length) {
        offers.push(...brandOffers);
      } else {
        failures.push(`${brand}: OrderWise CLI 未返回可提取价格`);
      }
    } catch (error) {
      failures.push(`${brand}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (offers.length) {
    return {
      source: "orderwiseCli",
      message: failures.length ? failures.join("；") : undefined,
      offers
    };
  }

  return {
    source: "orderwiseCli",
    status: failures.some((failure) => /登录|验证码|接管|INFO_ACTION_NEEDS_REPLY|session_id/i.test(failure))
      ? "login_required"
      : "unavailable",
    message: failures.length ? failures.join("；") : "OrderWise CLI 没有返回可比价结果"
  };
}

async function runOrderWisePython(
  options: OrderWiseCliSourceOptions,
  payload: OrderWisePythonPayload
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const script = [
    "import json, sys",
    "from orderwise_agent import compare_prices",
    "payload = json.loads(sys.stdin.read())",
    "result = compare_prices(",
    "  product_name=payload['productName'],",
    "  seller_name=payload.get('sellerName'),",
    "  apps=payload.get('apps'),",
    "  max_steps=payload.get('maxSteps', 100),",
    "  device_mapping=payload.get('deviceMapping'),",
    ")",
    `print(${JSON.stringify(RESULT_MARKER)})`,
    "print(json.dumps(result, ensure_ascii=False))"
  ].join("\n");

  return spawnText(options.pythonPath, ["-c", script], JSON.stringify(payload), {
    cwd: resolve(options.repoPath),
    env: process.env
  });
}

function spawnText(
  file: string,
  args: string[],
  stdin: string,
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const executable = resolveExecutablePath(file, options.cwd);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? 0
      });
    });
    child.stdin.end(stdin, "utf8");
  });
}

async function resolveDeviceMapping(
  options: OrderWiseCliSourceOptions,
  deps: OrderWiseCliSourceDeps
): Promise<Record<string, string>> {
  if (options.deviceMapping) {
    return sanitizeMapping(options.deviceMapping);
  }
  const reader = deps.readFile ?? readFile;
  try {
    return sanitizeMapping(JSON.parse(await reader(options.mappingPath, "utf8")) as Record<string, string>);
  } catch {
    return {};
  }
}

function selectAppDeviceMapping(apps: string[], mapping: Record<string, string>): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const app of apps) {
    const key = APP_NAME_TO_KEY[app] ?? app;
    const value = mapping[key] ?? mapping[app];
    if (value && !isPlaceholderDevice(value)) {
      selected[key] = value;
    }
  }
  return selected;
}

function toOffers(
  brand: string,
  productName: string,
  result: OrderWiseCliResult,
  query: CoffeeQuery
): PlatformSnapshotOffer[] {
  const offers: PlatformSnapshotOffer[] = [];
  for (const [app, platform] of Object.entries(result.platform_results ?? {})) {
    if (platform.status && platform.status !== "success") {
      continue;
    }
    const total = parseMoney(platform.total_fee ?? platform.totalFee);
    const itemPrice = parseMoney(platform.price) ?? total;
    if (total === null && itemPrice === null) {
      continue;
    }
    const deliveryFee = parseMoney(platform.delivery_fee ?? platform.deliveryFee) ?? 0;
    const packagingFee = parseMoney(platform.pack_fee ?? platform.packFee ?? platform.packaging_fee) ?? 0;
    offers.push({
      source: `orderwiseCli:${platform.app ?? app}`,
      brand,
      storeName: `${brand} ${platform.app ?? app}`,
      drinkName: productName,
      normalizedDrink: query.normalizedDrink,
      size: query.size,
      fulfillment: "delivery",
      itemPrice: roundCurrency((itemPrice ?? Math.max(0, total! - deliveryFee - packagingFee)) / Math.max(1, query.quantity)),
      quantity: query.quantity,
      deliveryFee,
      packagingFee,
      totalPrice: total !== null ? roundCurrency(total) : undefined,
      etaText: platform.duration ? `OrderWise CLI 执行 ${platform.duration}s` : undefined
    });
  }
  return offers;
}

function parseOrderWiseJson(stdout: string): OrderWiseCliResult {
  const markerIndex = stdout.lastIndexOf(RESULT_MARKER);
  const jsonText = markerIndex === -1
    ? stdout.trim().split(/\r?\n/).at(-1) ?? "{}"
    : stdout.slice(markerIndex + RESULT_MARKER.length).trim().split(/\r?\n/).at(0) ?? "{}";
  const parsed = JSON.parse(jsonText) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as OrderWiseCliResult
    : {};
}

function buildProductName(query: CoffeeQuery): string {
  return [query.temperature, query.drink, query.size]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim() || query.rawText;
}

function defaultPythonPath(repoPath: string): string {
  return process.platform === "win32"
    ? join(repoPath, ".venv", "Scripts", "python.exe")
    : join(repoPath, ".venv", "bin", "python");
}

function resolveExecutablePath(pathValue: string, repoPath: string): string {
  if (isAbsolute(pathValue) || !hasPathSeparator(pathValue)) {
    return pathValue;
  }
  const normalizedPath = normalizePath(pathValue);
  const normalizedRepo = normalizePath(repoPath).replace(/\/$/, "");
  if (normalizedPath.startsWith(`${normalizedRepo}/`) || normalizedPath.startsWith(".runtime/")) {
    return resolve(pathValue);
  }
  return resolve(repoPath, pathValue);
}

function hasPathSeparator(pathValue: string): boolean {
  return pathValue.includes("/") || pathValue.includes("\\");
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function sanitizeMapping(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry)]));
}

function parseJsonObject(value: string | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? sanitizeMapping(parsed as Record<string, string>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseRequiredJsonObject(flag: string, value: string | undefined): Record<string, string> {
  const parsed = parseJsonObject(requireValue(flag, value));
  if (!parsed) {
    throw new Error(`${flag} 必须是 JSON 对象`);
  }
  return parsed;
}

function parseMoney(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitCsv(value: string | undefined): string[] | null {
  if (!value) {
    return null;
  }
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? values : null;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRequiredInteger(flag: string, value: string | undefined): number {
  const parsed = parseOptionalInteger(requireValue(flag, value));
  if (parsed === undefined) {
    throw new Error(`${flag} 必须是整数`);
  }
  return parsed;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} 缺少参数值`);
  }
  return value;
}

function isPlaceholderDevice(value: string): boolean {
  return /your-cloud-phone-ip|:port$|device-id/i.test(value);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
