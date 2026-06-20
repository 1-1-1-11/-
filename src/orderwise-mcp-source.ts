import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { roundCurrency } from "./pricing.js";
import type { AddressConfig, CoffeeQuery, PlatformSnapshot, PlatformSnapshotOffer } from "./types.js";

interface ExternalPriceSourceRequest {
  query: CoffeeQuery;
  address: AddressConfig;
}

export interface OrderWiseMcpSourceOptions {
  endpoint: string;
  brands: string[];
  apps: string[];
  maxSteps: number;
  modelProvider?: string;
  deviceMapping?: Record<string, string>;
}

export interface OrderWiseMcpSourceDeps {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
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
  raw_result?: string;
  device_id?: string;
  duration?: number | string;
}

interface OrderWiseResult {
  error?: string;
  product_name?: string;
  seller_name?: string;
  stop_reason?: string;
  session_id?: string;
  message?: string;
  platforms?: OrderWisePlatformResult[];
  platform_results?: Record<string, OrderWisePlatformResult>;
  summary?: {
    best_price?: { app?: string; total_fee?: number | string };
    success_count?: number;
    failed_count?: number;
    interrupted?: boolean;
  };
  best_price?: { app?: string; total_fee?: number | string };
}

const DEFAULT_ENDPOINT = "http://127.0.0.1:8703/mcp";
const DEFAULT_BRANDS = ["瑞幸", "库迪", "星巴克", "Tims", "Manner", "M Stand", "Peet's"];
const DEFAULT_APPS = ["美团", "京东外卖", "淘宝闪购"];

export function parseOrderWiseMcpSourceArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): OrderWiseMcpSourceOptions {
  const options: OrderWiseMcpSourceOptions = {
    endpoint: env.ORDERWISE_MCP_URL ?? DEFAULT_ENDPOINT,
    brands: splitCsv(env.ORDERWISE_BRANDS) ?? DEFAULT_BRANDS,
    apps: splitCsv(env.ORDERWISE_APPS) ?? DEFAULT_APPS,
    maxSteps: parseOptionalInteger(env.ORDERWISE_MAX_STEPS) ?? 100,
    modelProvider: env.ORDERWISE_MODEL_PROVIDER,
    deviceMapping: parseJsonObject(env.ORDERWISE_DEVICE_MAPPING)
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--endpoint":
        options.endpoint = requireValue(arg, next);
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
      case "--model-provider":
        options.modelProvider = requireValue(arg, next);
        index += 1;
        break;
      case "--device-mapping":
        options.deviceMapping = parseRequiredJsonObject(arg, next);
        index += 1;
        break;
    }
  }

  return options;
}

export async function runOrderWiseMcpSourceCli(
  args: string[],
  deps: OrderWiseMcpSourceDeps = {}
): Promise<{ text: string; exitCode: number; snapshot: PlatformSnapshot }> {
  const options = parseOrderWiseMcpSourceArgs(args, deps.env);
  const stdin = deps.stdin ?? (await readStdin());
  const request = JSON.parse(stdin) as ExternalPriceSourceRequest;
  const snapshot = await buildOrderWiseMcpSnapshot(request, options, deps);
  return {
    text: `${JSON.stringify(snapshot)}\n`,
    exitCode: 0,
    snapshot
  };
}

export async function buildOrderWiseMcpSnapshot(
  request: ExternalPriceSourceRequest,
  options: OrderWiseMcpSourceOptions,
  deps: OrderWiseMcpSourceDeps = {}
): Promise<PlatformSnapshot> {
  let client: Client | null = null;
  const offers: PlatformSnapshotOffer[] = [];
  const failures: string[] = [];
  const productName = buildProductName(request.query);

  try {
    if (!deps.callTool) {
      client = await createOrderWiseMcpClient(options.endpoint);
    }
    const callTool =
      deps.callTool ??
      (async (name: string, args: Record<string, unknown>) => {
        const result = await client!.callTool({ name, arguments: args }, undefined, {
          timeout: Math.max(60_000, options.maxSteps * 5_000)
        });
        return result;
      });

    for (const brand of options.brands) {
      try {
        const result = await callTool("compare_prices", buildToolArgs(productName, brand, options));
        const payload = extractObject<OrderWiseResult>(result);
        const brandOffers = toOffers(brand, productName, payload, request.query);
        if (brandOffers.length) {
          offers.push(...brandOffers);
        } else {
          failures.push(`${brand}: ${summarizeOrderWiseFailure(payload)}`);
        }
      } catch (error) {
        failures.push(`${brand}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    return {
      source: "orderwiseMcp",
      status: "unavailable",
      message: `OrderWise MCP 调用失败：${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    await client?.close();
  }

  if (offers.length) {
    return {
      source: "orderwiseMcp",
      message: failures.length ? failures.join("；") : undefined,
      offers
    };
  }

  return {
    source: "orderwiseMcp",
    status: failures.some((failure) => /session_id|INFO_ACTION_NEEDS_REPLY|登录|验证|接管/.test(failure))
      ? "login_required"
      : "unavailable",
    message: failures.length ? failures.join("；") : "OrderWise MCP 没有返回可比价格"
  };
}

async function createOrderWiseMcpClient(endpoint: string): Promise<Client> {
  const client = new Client({
    name: "coffee-price-orderwise-mcp-source",
    version: "0.1.0"
  });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  await client.connect(transport);
  return client;
}

function buildToolArgs(
  productName: string,
  brand: string,
  options: OrderWiseMcpSourceOptions
): Record<string, unknown> {
  const args: Record<string, unknown> = {
    product_name: productName,
    seller_name: brand,
    apps: options.apps,
    max_steps: options.maxSteps
  };
  if (options.modelProvider) {
    args.model_provider = options.modelProvider;
  }
  if (options.deviceMapping) {
    args.device_mapping = options.deviceMapping;
  }
  return args;
}

function buildProductName(query: CoffeeQuery): string {
  return [query.temperature, query.drink, query.size]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim() || query.rawText;
}

function toOffers(
  brand: string,
  productName: string,
  result: OrderWiseResult,
  query: CoffeeQuery
): PlatformSnapshotOffer[] {
  const platforms = normalizePlatforms(result);
  const offers: PlatformSnapshotOffer[] = [];
  for (const platform of platforms) {
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
      source: `orderwiseMcp:${platform.app ?? "unknown"}`,
      brand,
      storeName: `${brand} ${platform.app ?? "OrderWise"}`,
      drinkName: productName,
      normalizedDrink: query.normalizedDrink,
      size: query.size,
      fulfillment: "delivery",
      itemPrice: roundCurrency((itemPrice ?? Math.max(0, total! - deliveryFee - packagingFee)) / Math.max(1, query.quantity)),
      quantity: query.quantity,
      deliveryFee,
      packagingFee,
      totalPrice: total !== null ? roundCurrency(total) : undefined,
      etaText: platform.duration ? `OrderWise 执行 ${platform.duration}s` : undefined
    });
  }
  return offers;
}

function normalizePlatforms(result: OrderWiseResult): OrderWisePlatformResult[] {
  if (Array.isArray(result.platforms)) {
    return result.platforms;
  }
  if (result.platform_results && typeof result.platform_results === "object") {
    return Object.entries(result.platform_results).map(([app, value]) => ({
      app,
      ...value
    }));
  }
  return [];
}

function summarizeOrderWiseFailure(result: OrderWiseResult): string {
  if (result.error) {
    return result.error;
  }
  if (result.stop_reason === "INFO_ACTION_NEEDS_REPLY") {
    return `需要用户接管：${result.message ?? "OrderWise 返回接管请求"}${result.session_id ? ` session_id=${result.session_id}` : ""}`;
  }
  const failed = normalizePlatforms(result).filter((platform) => platform.status === "failed" || platform.error);
  if (failed.length) {
    return failed.map((platform) => `${platform.app ?? "平台"}: ${platform.error ?? "未返回价格"}`).join("；");
  }
  return "未返回可提取价格";
}

function extractObject<T>(value: unknown): T {
  const payload = extractPayload(value);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as T;
  }
  return {} as T;
}

function extractPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  const object = value as Record<string, unknown>;
  if (object.structuredContent) {
    return object.structuredContent;
  }
  if (Array.isArray(object.content)) {
    for (const entry of object.content) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const text = (entry as { text?: unknown }).text;
      if (typeof text === "string") {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
    }
  }
  if (object.data) {
    return object.data;
  }
  if (object.result) {
    return object.result;
  }
  return value;
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

function parseJsonObject(value: string | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, string>
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

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
