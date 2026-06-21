import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { missingLuckinTokenMessage } from "./luckin-token-guidance.js";
import { roundCurrency } from "./pricing.js";
import { extractLuckinToken } from "./luckin-token-import.js";
import type {
  AddressConfig,
  CoffeeQuery,
  PlatformSnapshot,
  PlatformSnapshotOffer
} from "./types.js";

interface ExternalPriceSourceRequest {
  query: CoffeeQuery;
  address: AddressConfig;
}

export interface LuckinMcpSourceOptions {
  endpoint: string;
  token?: string;
  tokenEnvName?: string;
  tokenPath?: string;
  officialTokenEnvPath?: string;
  longitude?: number;
  latitude?: number;
  maxShops: number;
}

export interface ResolvedLuckinToken {
  token: string;
  source: string;
}

export interface LuckinMcpSourceDeps {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

interface LuckinShop {
  deptId: string | number;
  deptName?: string;
  address?: string;
  distance?: string | number;
}

interface LuckinProduct {
  productId: string | number;
  productName?: string;
  name?: string;
  skuCode?: string;
  initialPrice?: number | string;
  estimatePrice?: number | string;
}

interface LuckinPreview {
  totalInitialPrice?: number | string;
  privilegeMoney?: number | string;
  discountPrice?: number | string;
  couponCodeList?: string[];
  aboutTime?: number | string;
  productInfoList?: Array<{
    initPrice?: number | string;
    estimatePrice?: number | string;
    estimateTotalPrice?: number | string;
  }>;
}

const DEFAULT_ENDPOINT = "https://gwmcp.lkcoffee.com/order/user/mcp";
const DEFAULT_TOKEN_PATH = join(homedir(), ".my-coffee", "LUCKIN_MCP_TOKEN");
const DEFAULT_OFFICIAL_TOKEN_ENV_PATH = join(homedir(), ".luckin", ".env");

export function parseLuckinMcpSourceArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): LuckinMcpSourceOptions {
  const tokenEnvName = env.LUCKIN_MCP_TOKEN?.trim()
    ? "LUCKIN_MCP_TOKEN"
    : env.LUCKIN_MCP_ORDER_TOKEN?.trim()
      ? "LUCKIN_MCP_ORDER_TOKEN"
      : undefined;
  const options: LuckinMcpSourceOptions = {
    endpoint: env.LUCKIN_MCP_URL ?? DEFAULT_ENDPOINT,
    token: tokenEnvName ? env[tokenEnvName] : undefined,
    tokenEnvName,
    tokenPath: env.LUCKIN_MCP_TOKEN_FILE ?? DEFAULT_TOKEN_PATH,
    officialTokenEnvPath: env.LUCKIN_OFFICIAL_ENV_FILE ?? DEFAULT_OFFICIAL_TOKEN_ENV_PATH,
    longitude: parseOptionalNumber(env.LUCKIN_LONGITUDE),
    latitude: parseOptionalNumber(env.LUCKIN_LATITUDE),
    maxShops: parseOptionalInteger(env.LUCKIN_MAX_SHOPS) ?? 5
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--endpoint":
        options.endpoint = requireValue(arg, next);
        index += 1;
        break;
      case "--token":
        options.token = requireValue(arg, next);
        options.tokenEnvName = undefined;
        index += 1;
        break;
      case "--token-file":
        options.tokenPath = requireValue(arg, next);
        index += 1;
        break;
      case "--official-env-file":
        options.officialTokenEnvPath = requireValue(arg, next);
        index += 1;
        break;
      case "--longitude":
        options.longitude = parseRequiredNumber(arg, next);
        index += 1;
        break;
      case "--latitude":
        options.latitude = parseRequiredNumber(arg, next);
        index += 1;
        break;
      case "--max-shops":
        options.maxShops = parseRequiredInteger(arg, next);
        index += 1;
        break;
    }
  }

  return options;
}

export async function runLuckinMcpSourceCli(
  args: string[],
  deps: LuckinMcpSourceDeps = {}
): Promise<{ text: string; exitCode: number; snapshot: PlatformSnapshot }> {
  const options = parseLuckinMcpSourceArgs(args, deps.env);
  const stdin = deps.stdin ?? (await readStdin());
  const request = JSON.parse(stdin) as ExternalPriceSourceRequest;
  const snapshot = await buildLuckinMcpSnapshot(request, options, deps);
  return {
    text: `${JSON.stringify(snapshot)}\n`,
    exitCode: 0,
    snapshot
  };
}

export async function buildLuckinMcpSnapshot(
  request: ExternalPriceSourceRequest,
  options: LuckinMcpSourceOptions,
  deps: LuckinMcpSourceDeps = {}
): Promise<PlatformSnapshot> {
  const resolvedToken = await resolveLuckinToken(options, deps);
  const token = resolvedToken?.token;
  if (!token) {
    return statusSnapshot("login_required", missingLuckinTokenMessage("瑞幸官方 MCP"));
  }

  const longitude = options.longitude ?? request.address.longitude;
  const latitude = options.latitude ?? request.address.latitude;
  if (!isFiniteNumber(longitude) || !isFiniteNumber(latitude)) {
    return statusSnapshot("unavailable", "瑞幸官方 MCP 需要经纬度；请在地址配置中填写 longitude 和 latitude");
  }

  const client = deps.callTool ? null : await createLuckinMcpClient(options.endpoint, token);
  const callTool =
    deps.callTool ??
    (async (name: string, args: Record<string, unknown>) => {
      const result = await client!.callTool({ name, arguments: args });
      return result;
    });

  try {
    const shopsPayload = await callTool("queryShopList", { longitude, latitude });
    const shops = extractArray<LuckinShop>(shopsPayload, [
      "shopList",
      "shops",
      "list",
      "records",
      "data"
    ]).filter((shop) => shop.deptId !== undefined && shop.deptId !== null);

    if (!shops.length) {
      return statusSnapshot("no_stock", "瑞幸官方 MCP 没有返回附近可用门店");
    }

    const offers: PlatformSnapshotOffer[] = [];
    const productQuery = buildProductQuery(request.query);
    for (const shop of shops.slice(0, Math.max(1, options.maxShops))) {
      const productsPayload = await callTool("searchProductForMcp", {
        deptId: shop.deptId,
        query: productQuery
      });
      const products = extractArray<LuckinProduct>(productsPayload, [
        "productInfoList",
        "productList",
        "products",
        "list",
        "records",
        "data"
      ]);
      const product = pickBestProduct(products, request.query);
      if (!product?.productId || !product.skuCode) {
        continue;
      }

      const previewPayload = await callTool("previewOrder", {
        deptId: shop.deptId,
        productList: [
          {
            amount: request.query.quantity,
            productId: product.productId,
            skuCode: product.skuCode
          }
        ]
      });
      const preview = extractObject<LuckinPreview>(previewPayload);
      offers.push(toPickupOffer(shop, product, preview, request.query));
    }

    if (!offers.length) {
      return statusSnapshot("no_stock", "瑞幸官方 MCP 没有返回可比商品或价格预览");
    }

    return {
      source: "luckinMcp",
      offers
    };
  } catch (error) {
    return statusSnapshot(
      "unavailable",
      `瑞幸官方 MCP 调用失败：${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await client?.close();
  }
}

function buildProductQuery(query: CoffeeQuery): string {
  return [query.temperature, query.drink, query.size].filter(Boolean).join(" ") || query.rawText;
}

function pickBestProduct(products: LuckinProduct[], query: CoffeeQuery): LuckinProduct | null {
  if (!products.length) {
    return null;
  }
  const size = query.size?.toLowerCase();
  const scored = products.map((product) => {
    const name = `${product.productName ?? product.name ?? ""}`.toLowerCase();
    let score = 0;
    if (query.normalizedDrink === "americano" && /美式|americano/i.test(name)) score += 3;
    if (query.normalizedDrink === "latte" && /拿铁|latte/i.test(name)) score += 3;
    if (query.normalizedDrink === "flat_white" && /澳白|馥芮白|flat/i.test(name)) score += 3;
    if (query.normalizedDrink === "cappuccino" && /卡布|cappuccino/i.test(name)) score += 3;
    if (query.normalizedDrink === "mocha" && /摩卡|mocha/i.test(name)) score += 3;
    if (size && name.includes(size)) score += 1;
    return { product, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.product ?? null;
}

function toPickupOffer(
  shop: LuckinShop,
  product: LuckinProduct,
  preview: LuckinPreview,
  query: CoffeeQuery
): PlatformSnapshotOffer {
  const productInfo = preview.productInfoList?.[0];
  const totalInitial =
    parseMoney(preview.totalInitialPrice) ??
    parseMoney(productInfo?.estimateTotalPrice) ??
    parseMoney(productInfo?.initPrice) ??
    parseMoney(product.initialPrice) ??
    parseMoney(product.estimatePrice) ??
    0;
  const discountPrice =
    parseMoney(preview.discountPrice) ??
    parseMoney(productInfo?.estimateTotalPrice) ??
    parseMoney(productInfo?.estimatePrice) ??
    parseMoney(product.estimatePrice) ??
    totalInitial;
  const discount =
    parseMoney(preview.privilegeMoney) ?? roundCurrency(Math.max(0, totalInitial - discountPrice));
  const itemPrice = roundCurrency(totalInitial / Math.max(1, query.quantity));

  return {
    brand: "瑞幸",
    storeName: shop.deptName ?? shop.address ?? "瑞幸门店",
    drinkName: product.productName ?? product.name ?? query.drink,
    normalizedDrink: query.normalizedDrink,
    size: query.size,
    fulfillment: "pickup",
    itemPrice,
    quantity: query.quantity,
    discounts: discount > 0 ? [{ label: "瑞幸官方 MCP 预览优惠", amount: discount }] : [],
    distanceText: formatDistance(shop.distance),
    etaText: formatAboutTime(preview.aboutTime)
  };
}

async function createLuckinMcpClient(endpoint: string, token: string): Promise<Client> {
  const client = new Client({
    name: "coffee-price-luckin-mcp-source",
    version: "0.1.0"
  });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });
  await client.connect(transport);
  return client;
}

export async function resolveLuckinToken(
  options: LuckinMcpSourceOptions,
  deps: LuckinMcpSourceDeps
): Promise<ResolvedLuckinToken | null> {
  const directToken = normalizeLuckinToken(options.token);
  if (directToken) {
    return {
      token: directToken,
      source: options.tokenEnvName ?? "command line token"
    };
  }
  const reader = deps.readFile ?? readFile;
  if (!options.tokenPath) {
    return readOfficialLuckinToken(options.officialTokenEnvPath, reader);
  }
  try {
    const fileToken = normalizeLuckinToken(await reader(options.tokenPath, "utf8"));
    if (fileToken) {
      return {
        token: fileToken,
        source: options.tokenPath
      };
    }
  } catch {
    // Fall through to the official Luckin CLI env file.
  }
  return readOfficialLuckinToken(options.officialTokenEnvPath, reader);
}

async function readOfficialLuckinToken(
  path: string | undefined,
  reader: (path: string, encoding: BufferEncoding) => Promise<string>
): Promise<ResolvedLuckinToken | null> {
  if (!path) {
    return null;
  }
  try {
    const parsed = parseDotEnv(await reader(path, "utf8"));
    const token =
      normalizeLuckinToken(parsed.LUCKIN_MCP_ORDER_TOKEN) ??
      normalizeLuckinToken(parsed.LUCKIN_MCP_TOKEN);
    return token ? { token, source: path } : null;
  } catch {
    return null;
  }
}

function parseDotEnv(content: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    entries[match[1]] = unquoteEnvValue(match[2]);
  }
  return entries;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeLuckinToken(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  return extractLuckinToken(value) ?? value.trim().replace(/^Bearer\s+/i, "");
}

function extractArray<T>(value: unknown, keys: string[]): T[] {
  const payload = extractPayload(value);
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (payload && typeof payload === "object") {
    const directObject = payload as Record<string, unknown>;
    for (const key of keys) {
      const candidate = directObject[key];
      if (Array.isArray(candidate)) {
        return candidate as T[];
      }
    }
  }
  const object = extractObject<Record<string, unknown>>(payload);
  for (const key of keys) {
    const candidate = object[key];
    if (Array.isArray(candidate)) {
      return candidate as T[];
    }
    if (candidate && typeof candidate === "object") {
      const nested = extractArray<T>(candidate, keys);
      if (nested.length) {
        return nested;
      }
    }
  }
  return [];
}

function extractObject<T>(value: unknown): T {
  const payload = extractPayload(value);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const object = payload as Record<string, unknown>;
    if (object.data && typeof object.data === "object" && !Array.isArray(object.data)) {
      return object.data as T;
    }
    if (object.result && typeof object.result === "object" && !Array.isArray(object.result)) {
      return object.result as T;
    }
    return object as T;
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

function statusSnapshot(
  status: "login_required" | "no_stock" | "unavailable",
  message: string
): PlatformSnapshot {
  return {
    source: "luckinMcp",
    status,
    message
  };
}

function formatDistance(distance: string | number | undefined): string | undefined {
  const parsed = parseMoney(distance);
  if (parsed === null) {
    return typeof distance === "string" ? distance : undefined;
  }
  return `${roundCurrency(parsed)}km`;
}

function formatAboutTime(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  if (numeric > 10_000_000_000) {
    return new Date(numeric).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  if (numeric > 1_000_000_000) {
    return new Date(numeric * 1000).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  return `${numeric}分钟`;
}

function parseMoney(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRequiredNumber(flag: string, value: string | undefined): number {
  const parsed = Number.parseFloat(requireValue(flag, value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} 必须是数字`);
  }
  return parsed;
}

function parseRequiredInteger(flag: string, value: string | undefined): number {
  const parsed = Number.parseInt(requireValue(flag, value), 10);
  if (!Number.isFinite(parsed)) {
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
