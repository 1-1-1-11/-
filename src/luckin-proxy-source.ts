import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { expiredLuckinTokenMessage, missingLuckinTokenMessage } from "./luckin-token-guidance.js";
import { parseLuckinMcpSourceArgs, resolveLuckinToken, type LuckinMcpSourceOptions } from "./luckin-mcp-source.js";
import { roundCurrency } from "./pricing.js";
import type { AddressConfig, CoffeeQuery, PlatformSnapshot, PlatformSnapshotOffer } from "./types.js";

interface ExternalPriceSourceRequest {
  query: CoffeeQuery;
  address: AddressConfig;
}

export interface LuckinProxySourceOptions extends LuckinMcpSourceOptions {
  command: string;
  args: string[];
  shopName?: string;
  timeoutMs: number;
}

export interface LuckinProxySourceDeps {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

interface LuckinProxyShop {
  deptId?: string | number;
  deptName?: string;
  address?: string;
  longitude?: number;
  latitude?: number;
}

interface LuckinProxyPreview {
  status?: string;
  draftId?: string;
  productName?: string;
  attrs?: string;
  shopName?: string;
  price?: string | number;
  originalPrice?: string | number;
  discount?: string | number;
  message?: string;
  candidates?: Array<{ productName?: string; skuCode?: string; attrs?: string }>;
}

const DEFAULT_COMMAND = "npx";
const DEFAULT_ARGS = ["-y", "github:wyhAcc/luckin-mcp-proxy"];
const DEFAULT_TIMEOUT_MS = 180_000;
const AUTH_ERROR_PATTERN =
  /缺少.*LUCKIN_MCP_TOKEN|LUCKIN_MCP_TOKEN.*(?:missing|empty)|token.*(?:过期|失效|无效|invalid|expired)|401|Unauthorized/i;

export function parseLuckinProxySourceArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): LuckinProxySourceOptions {
  const base = parseLuckinMcpSourceArgs(args, env);
  const options: LuckinProxySourceOptions = {
    ...base,
    command: env.LUCKIN_PROXY_COMMAND ?? DEFAULT_COMMAND,
    args: parseJsonStringArray(env.LUCKIN_PROXY_ARGS) ?? DEFAULT_ARGS,
    shopName: env.LUCKIN_PROXY_SHOP_NAME,
    timeoutMs: parseOptionalInteger(env.LUCKIN_PROXY_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--command":
        options.command = requireValue(arg, next);
        index += 1;
        break;
      case "--arg":
        options.args.push(requireValue(arg, next));
        index += 1;
        break;
      case "--args-json":
        options.args = parseRequiredJsonStringArray(arg, requireValue(arg, next));
        index += 1;
        break;
      case "--shop-name":
        options.shopName = requireValue(arg, next);
        index += 1;
        break;
      case "--timeout-ms":
        options.timeoutMs = parseRequiredInteger(arg, next);
        index += 1;
        break;
    }
  }

  return options;
}

export async function runLuckinProxySourceCli(
  args: string[],
  deps: LuckinProxySourceDeps = {}
): Promise<{ text: string; exitCode: number; snapshot: PlatformSnapshot }> {
  const options = parseLuckinProxySourceArgs(args, deps.env);
  const stdin = deps.stdin ?? (await readStdin());
  const request = JSON.parse(stdin) as ExternalPriceSourceRequest;
  const snapshot = await buildLuckinProxySnapshot(request, options, deps);
  return {
    text: `${JSON.stringify(snapshot)}\n`,
    exitCode: 0,
    snapshot
  };
}

export async function buildLuckinProxySnapshot(
  request: ExternalPriceSourceRequest,
  options: LuckinProxySourceOptions,
  deps: LuckinProxySourceDeps = {}
): Promise<PlatformSnapshot> {
  const resolvedToken = await resolveLuckinToken(options, deps);
  if (!resolvedToken?.token) {
    return statusSnapshot("login_required", missingLuckinTokenMessage("瑞幸 MCP Proxy"));
  }

  const longitude = options.longitude ?? request.address.longitude;
  const latitude = options.latitude ?? request.address.latitude;
  if (!isFiniteNumber(longitude) || !isFiniteNumber(latitude)) {
    return statusSnapshot("unavailable", "瑞幸 MCP Proxy 需要经纬度；请在地址配置中填写 longitude 和 latitude。");
  }

  const client = deps.callTool ? null : await createLuckinProxyClient(options, resolvedToken.token, deps.env);
  const callTool =
    deps.callTool ??
    (async (name: string, args: Record<string, unknown>) => {
      const result = await client!.callTool({ name, arguments: args }, undefined, {
        timeout: options.timeoutMs
      });
      return extractMcpPayload(result);
    });

  try {
    const shopKeyword = options.shopName ?? request.address.query;
    const shopsPayload = await callTool("findShop", {
      name: shopKeyword,
      longitude,
      latitude
    });
    const shops = extractArray<LuckinProxyShop>(shopsPayload);
    const shop = shops[0];
    if (!shop?.deptName) {
      return statusSnapshot("no_stock", `瑞幸 MCP Proxy 没有找到匹配门店：${shopKeyword}`);
    }

    const previewPayload = await callTool("quickOrder", {
      query: buildProductQuery(request.query),
      shopName: shop.deptName,
      amount: request.query.quantity
    });
    const preview = extractObject<LuckinProxyPreview>(previewPayload);
    if (preview.status === "candidates") {
      return statusSnapshot(
        "no_stock",
        preview.message ??
          `瑞幸 MCP Proxy 没有找到完全匹配 ${request.query.drink} 的 SKU：${formatCandidates(preview.candidates)}`
      );
    }
    if (preview.status && preview.status !== "preview") {
      return statusSnapshot("unavailable", `瑞幸 MCP Proxy 返回未知状态：${preview.status}`);
    }
    const offer = toPickupOffer(shop, preview, request.query);
    if (!offer) {
      return statusSnapshot("no_stock", "瑞幸 MCP Proxy 没有返回可比价格预览。");
    }
    return {
      source: "luckinProxyMcp",
      offers: [offer]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (AUTH_ERROR_PATTERN.test(message)) {
      return statusSnapshot("login_required", `${expiredLuckinTokenMessage("瑞幸 MCP Proxy")} 原始错误：${message}`);
    }
    return statusSnapshot("unavailable", `瑞幸 MCP Proxy 调用失败：${message}`);
  } finally {
    await client?.close();
  }
}

async function createLuckinProxyClient(
  options: LuckinProxySourceOptions,
  token: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<Client> {
  const client = new Client({
    name: "coffee-price-luckin-proxy-source",
    version: "0.1.0"
  });
  const transport = new StdioClientTransport({
    command: options.command,
    args: options.args,
    cwd: process.cwd(),
    stderr: "pipe",
    env: buildProxyEnv(env ?? process.env, token)
  });
  await client.connect(transport);
  return client;
}

function buildProxyEnv(env: NodeJS.ProcessEnv, token: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  next.LUCKIN_MCP_TOKEN = token;
  next.LUCKIN_MCP_ORDER_TOKEN = token;
  return next;
}

function toPickupOffer(
  shop: LuckinProxyShop,
  preview: LuckinProxyPreview,
  query: CoffeeQuery
): PlatformSnapshotOffer | null {
  const total = parseMoney(preview.price);
  const original = parseMoney(preview.originalPrice);
  if (total === null && original === null) {
    return null;
  }
  const totalInitial = original ?? total ?? 0;
  const discount = parseMoney(preview.discount) ?? Math.max(0, totalInitial - (total ?? totalInitial));
  return {
    source: "luckinProxyMcp",
    brand: "瑞幸",
    storeName: preview.shopName ?? shop.deptName ?? shop.address ?? "瑞幸门店",
    drinkName: preview.productName ?? query.drink,
    normalizedDrink: query.normalizedDrink,
    size: query.size,
    fulfillment: "pickup",
    itemPrice: roundCurrency(totalInitial / Math.max(1, query.quantity)),
    quantity: query.quantity,
    discounts: discount > 0 ? [{ label: "瑞幸 MCP Proxy 预览优惠", amount: roundCurrency(discount) }] : [],
    etaText: preview.attrs,
    totalPrice: total !== null ? roundCurrency(total) : undefined
  };
}

function buildProductQuery(query: CoffeeQuery): string {
  return [query.size, query.temperature, query.drink].filter(Boolean).join(" ") || query.rawText;
}

function extractMcpPayload(value: unknown): unknown {
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

function extractArray<T>(value: unknown): T[] {
  const payload = extractMcpPayload(value);
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (payload && typeof payload === "object") {
    for (const key of ["data", "result", "shops", "list"]) {
      const candidate = (payload as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) {
        return candidate as T[];
      }
    }
  }
  return [];
}

function extractObject<T>(value: unknown): T {
  const payload = extractMcpPayload(value);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as T;
  }
  return {} as T;
}

function statusSnapshot(status: "login_required" | "no_stock" | "unavailable", message: string): PlatformSnapshot {
  return {
    source: "luckinProxyMcp",
    status,
    message
  };
}

function formatCandidates(candidates: LuckinProxyPreview["candidates"]): string {
  return (candidates ?? [])
    .slice(0, 3)
    .map((candidate) => [candidate.productName, candidate.attrs].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("；");
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

function parseJsonStringArray(value: string | undefined): string[] | null {
  if (!value) {
    return null;
  }
  try {
    return parseRequiredJsonStringArray("LUCKIN_PROXY_ARGS", value);
  } catch {
    return null;
  }
}

function parseRequiredJsonStringArray(flag: string, value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`${flag} 必须是 JSON 字符串数组`);
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readStdin(): Promise<string> {
  return new Promise((resolveStdin, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolveStdin(Buffer.concat(chunks).toString("utf8")));
  });
}
