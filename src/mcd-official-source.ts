import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { roundCurrency } from "./pricing.js";
import type { AddressConfig, CoffeeQuery, PlatformSnapshot, PlatformSnapshotOffer } from "./types.js";

interface ExternalPriceSourceRequest {
  query: CoffeeQuery;
  address: AddressConfig;
}

export interface McdOfficialSourceOptions {
  endpoint: string;
  token?: string;
  tokenPath?: string;
  maxStores: number;
  timeoutMs: number;
}

export interface McdOfficialSourceDeps {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

interface McdStore {
  storeCode: string;
  beCode: string;
  storeName?: string;
  address?: string;
  distance?: string | number;
}

interface McdMeal {
  code: string;
  name: string;
  currentPrice?: string | number;
}

interface McdPrice {
  productOriginalPrice?: string | number;
  productPrice?: string | number;
  originalPrice?: string | number;
  discount?: string | number;
  price?: string | number;
  productList?: Array<{
    productCode?: string;
    productName?: string;
    quantity?: number;
    originalSubtotal?: string | number;
    subtotal?: string | number;
  }>;
}

const DEFAULT_ENDPOINT = "https://mcp.mcd.cn";
const DEFAULT_TOKEN_PATH = join(homedir(), ".my-coffee", "MCD_MCP_TOKEN");
const DEFAULT_MAX_STORES = 3;
const DEFAULT_TIMEOUT_MS = 120_000;

export function parseMcdOfficialSourceArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): McdOfficialSourceOptions {
  const options: McdOfficialSourceOptions = {
    endpoint: env.MCD_MCP_URL ?? env.MCD_URL ?? DEFAULT_ENDPOINT,
    token: firstNonBlank(env.MCD_MCP_TOKEN, env.MCD_TOKEN, env.MCDCN_MCP_TOKEN) ?? undefined,
    tokenPath: env.MCD_MCP_TOKEN_FILE ?? env.MCD_TOKEN_FILE ?? DEFAULT_TOKEN_PATH,
    maxStores: parseOptionalInteger(env.MCD_MCP_MAX_STORES) ?? DEFAULT_MAX_STORES,
    timeoutMs: parseOptionalInteger(env.MCD_MCP_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--endpoint":
      case "--url":
        options.endpoint = requireValue(arg, next);
        index += 1;
        break;
      case "--token":
        options.token = stripBearer(requireValue(arg, next));
        index += 1;
        break;
      case "--token-file":
        options.tokenPath = requireValue(arg, next);
        index += 1;
        break;
      case "--max-stores":
        options.maxStores = parseRequiredInteger(arg, next);
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

export async function runMcdOfficialSourceCli(
  args: string[],
  deps: McdOfficialSourceDeps = {}
): Promise<{ text: string; exitCode: number; snapshot: PlatformSnapshot }> {
  const options = parseMcdOfficialSourceArgs(args, deps.env);
  const stdin = deps.stdin ?? (await readStdin());
  const request = JSON.parse(stdin) as ExternalPriceSourceRequest;
  const snapshot = await buildMcdOfficialSnapshot(request, options, deps);
  return {
    text: `${JSON.stringify(snapshot)}\n`,
    exitCode: 0,
    snapshot
  };
}

export async function buildMcdOfficialSnapshot(
  request: ExternalPriceSourceRequest,
  options: McdOfficialSourceOptions,
  deps: McdOfficialSourceDeps = {}
): Promise<PlatformSnapshot> {
  const token = await resolveMcdToken(options, deps);
  if (!token) {
    return statusSnapshot("login_required", missingMcdTokenMessage());
  }

  let close: (() => Promise<void>) | undefined;
  let callTool = deps.callTool;
  if (!callTool) {
    const caller = await createMcdToolCaller(options, token);
    callTool = caller.callTool;
    close = caller.close;
  }

  try {
    const city = parseCity(request.address.query);
    const stores = parseStores(
      await callTool("query-nearby-stores", {
        searchType: 2,
        beType: 1,
        city,
        keyword: request.address.query
      })
    );
    if (!stores.length) {
      return statusSnapshot("no_stock", "麦当劳官方 MCP 没有返回附近可自取门店。");
    }

    const offers: PlatformSnapshotOffer[] = [];
    const failures: string[] = [];
    for (const store of stores.slice(0, Math.max(1, options.maxStores))) {
      const baseArgs = {
        storeCode: store.storeCode,
        beCode: store.beCode,
        orderType: 1,
        beType: 1
      };
      const meals = parseMeals(await callTool("query-meals", baseArgs));
      const meal = pickBestMeal(meals, request.query);
      if (!meal) {
        failures.push(`${store.storeName ?? store.storeCode}: 没有匹配 ${request.query.drink}`);
        continue;
      }
      const price = parsePrice(
        await callTool("calculate-price", {
          ...baseArgs,
          items: [{ productCode: meal.code, quantity: request.query.quantity }]
        })
      );
      offers.push(toPickupOffer(store, meal, price, request.query));
    }

    if (offers.length) {
      return {
        source: "mcdOfficial",
        message: failures.length ? failures.join("；") : undefined,
        offers
      };
    }
    return statusSnapshot(
      failures.length ? "no_stock" : "unavailable",
      failures.length ? failures.join("；") : "麦当劳官方 MCP 没有返回可比咖啡价格。"
    );
  } catch (error) {
    const message = errorMessage(error);
    if (isAuthError(message)) {
      return statusSnapshot("login_required", expiredMcdTokenMessage());
    }
    return statusSnapshot("unavailable", `麦当劳官方 MCP 不可用：${message}`);
  } finally {
    await close?.();
  }
}

async function resolveMcdToken(
  options: McdOfficialSourceOptions,
  deps: McdOfficialSourceDeps
): Promise<string | null> {
  if (options.token?.trim()) {
    return stripBearer(options.token);
  }
  if (!options.tokenPath) {
    return null;
  }
  try {
    const token = (await (deps.readFile ?? readFile)(options.tokenPath, "utf8")).trim();
    return token ? stripBearer(token) : null;
  } catch {
    return null;
  }
}

async function createMcdToolCaller(
  options: McdOfficialSourceOptions,
  token: string
): Promise<{
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
}> {
  const client = new Client({
    name: "coffee-price-mcd-official-source",
    version: "0.1.0"
  });
  const transport = new StreamableHTTPClientTransport(new URL(options.endpoint), {
    requestInit: {
      headers: {
        authorization: `Bearer ${token}`
      }
    }
  });
  await client.connect(transport);
  return {
    callTool: (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: options.timeoutMs }),
    close: () => client.close()
  };
}

function parseStores(result: unknown): McdStore[] {
  const data = unwrapData(extractMcpPayload(result));
  const rows = Array.isArray(data) ? data : findArray(data, ["stores", "storeList", "list", "records"]);
  return rows.map(normalizeStore).filter((store): store is McdStore => Boolean(store));
}

function normalizeStore(row: unknown): McdStore | null {
  if (!isRecord(row)) {
    return null;
  }
  const storeCode = readString(row, ["storeCode", "storeId", "code"]);
  const beCode = readString(row, ["beCode", "BECode", "be"]);
  if (!storeCode || !beCode) {
    return null;
  }
  return {
    storeCode,
    beCode,
    storeName: readString(row, ["storeName", "name"]) ?? undefined,
    address: readString(row, ["address", "addr"]) ?? undefined,
    distance: readRaw(row, ["distance", "distanceText"]) as string | number | undefined
  };
}

function parseMeals(result: unknown): McdMeal[] {
  const data = unwrapData(extractMcpPayload(result));
  if (isRecord(data) && isRecord(data.meals)) {
    return Object.entries(data.meals)
      .map(([code, entry]) => normalizeMeal(code, entry))
      .filter((meal): meal is McdMeal => Boolean(meal));
  }
  const rows = Array.isArray(data) ? data : findArray(data, ["meals", "mealList", "products", "items", "list"]);
  return rows.map((row) => normalizeMeal(undefined, row)).filter((meal): meal is McdMeal => Boolean(meal));
}

function normalizeMeal(codeFromMap: string | undefined, row: unknown): McdMeal | null {
  if (!isRecord(row)) {
    return null;
  }
  const code = codeFromMap ?? readString(row, ["code", "productCode", "mealCode", "id"]);
  const name = readString(row, ["name", "productName", "mealName", "title"]);
  if (!code || !name) {
    return null;
  }
  return {
    code,
    name,
    currentPrice: readMoneyLike(row, ["currentPrice", "price", "productPrice"])
  };
}

function parsePrice(result: unknown): McdPrice {
  const data = unwrapData(extractMcpPayload(result));
  return isRecord(data) ? data as McdPrice : {};
}

function pickBestMeal(meals: McdMeal[], query: CoffeeQuery): McdMeal | null {
  if (!meals.length) {
    return null;
  }
  const scored = meals
    .map((meal) => ({ meal, score: scoreMeal(meal, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  return scored[0]?.meal ?? null;
}

function scoreMeal(meal: McdMeal, query: CoffeeQuery): number {
  const name = meal.name.toLowerCase();
  let score = 0;
  if (query.normalizedDrink === "americano" && /美式|americano|鲜萃咖啡|黑咖啡/i.test(name)) score += 6;
  if (query.normalizedDrink === "latte" && /拿铁|latte/i.test(name)) score += 6;
  if (query.normalizedDrink === "flat_white" && /澳白|馥芮白|flat\s*white/i.test(name)) score += 6;
  if (query.normalizedDrink === "cappuccino" && /卡布|cappuccino/i.test(name)) score += 6;
  if (query.normalizedDrink === "mocha" && /摩卡|mocha/i.test(name)) score += 6;
  if (/麦咖啡|mccaf|咖啡|coffee/i.test(name)) score += 1;
  if (query.temperature === "冰" && /冰|冷|iced/i.test(name)) score += 2;
  if (query.temperature === "热" && /热|hot/i.test(name)) score += 2;
  if (query.temperature === "冰" && /热|hot/i.test(name)) score -= 1;
  if (query.temperature === "热" && /冰|冷|iced/i.test(name)) score -= 1;
  if (query.size && name.includes(query.size.toLowerCase())) score += 1;
  return score;
}

function toPickupOffer(
  store: McdStore,
  meal: McdMeal,
  price: McdPrice,
  query: CoffeeQuery
): PlatformSnapshotOffer {
  const product = price.productList?.find((entry) => entry.productCode === meal.code) ?? price.productList?.[0];
  const quantity = Math.max(1, query.quantity);
  const originalSubtotal =
    moneyFromApiCents(product?.originalSubtotal) ??
    moneyFromApiCents(price.productOriginalPrice) ??
    moneyFromApiCents(price.productPrice) ??
    multiplyYuan(meal.currentPrice, quantity) ??
    0;
  const total =
    moneyFromApiCents(price.price) ??
    moneyFromApiCents(product?.subtotal) ??
    moneyFromApiCents(price.productPrice) ??
    originalSubtotal;
  const discount = moneyFromApiCents(price.discount) ?? roundCurrency(Math.max(0, originalSubtotal - total));

  return {
    source: "mcdOfficial",
    brand: "麦咖啡",
    storeName: store.storeName ?? store.address ?? "麦当劳门店",
    drinkName: product?.productName ?? meal.name,
    normalizedDrink: query.normalizedDrink,
    size: query.size,
    fulfillment: "pickup",
    itemPrice: roundCurrency(originalSubtotal / quantity),
    quantity,
    discounts: discount > 0 ? [{ label: "麦当劳官方 MCP 优惠", amount: discount }] : [],
    distanceText: formatDistance(store.distance),
    totalPrice: roundCurrency(total)
  };
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
      if (!isRecord(entry)) {
        continue;
      }
      const text = entry.text;
      if (typeof text === "string") {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
    }
  }
  return value;
}

function unwrapData(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  if (value.data !== undefined) {
    return value.data;
  }
  if (value.result !== undefined) {
    return unwrapData(value.result);
  }
  return value;
}

function findArray(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [];
  }
  for (const [key, entry] of Object.entries(value)) {
    if (keys.some((candidate) => normalizeKey(candidate) === normalizeKey(key)) && Array.isArray(entry)) {
      return entry;
    }
  }
  for (const entry of Object.values(value)) {
    const nested = findArray(entry, keys);
    if (nested.length) {
      return nested;
    }
  }
  return [];
}

function parseCity(query: string): string {
  const direct = query.match(/([\p{Script=Han}]{2,12}市)/u)?.[1];
  if (direct) {
    return direct;
  }
  const known = ["深圳", "广州", "上海", "北京", "杭州", "南京", "苏州", "成都", "重庆", "武汉", "西安"];
  const matched = known.find((city) => query.includes(city));
  return matched ? `${matched}市` : query;
}

function readString(row: Record<string, unknown>, aliases: string[]): string | null {
  const value = readRaw(row, aliases);
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return String(value).trim();
}

function readRaw(row: Record<string, unknown>, aliases: string[]): unknown {
  for (const [key, value] of Object.entries(row)) {
    if (aliases.some((alias) => normalizeKey(alias) === normalizeKey(key))) {
      return value;
    }
  }
  return undefined;
}

function readMoneyLike(row: Record<string, unknown>, aliases: string[]): string | number | undefined {
  const value = readRaw(row, aliases);
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function normalizeKey(value: string): string {
  return value.replace(/[\s_\-:：]/g, "").toLowerCase();
}

function moneyFromApiCents(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? roundCurrency(value / 100) : null;
  }
  const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return value.includes(".") ? parsed : roundCurrency(parsed / 100);
}

function multiplyYuan(value: string | number | undefined, quantity: number): number | null {
  const unit = moneyFromYuan(value);
  return unit === null ? null : roundCurrency(unit * quantity);
}

function moneyFromYuan(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDistance(distance: string | number | undefined): string | undefined {
  if (distance === undefined || distance === null || distance === "") {
    return undefined;
  }
  return String(distance);
}

function statusSnapshot(status: "login_required" | "no_stock" | "unavailable", message: string): PlatformSnapshot {
  return {
    source: "mcdOfficial",
    status,
    message
  };
}

function missingMcdTokenMessage(): string {
  return [
    "未检测到麦当劳 MCP token。",
    "请在麦当劳 MCP 平台 https://open.mcd.cn/mcp 获取 token 后，在微信私聊发送：绑定麦当劳 token Authorization: Bearer <你的麦当劳 MCP token>。",
    "本工具只会查询门店、菜单和 calculate-price，不会自动下单。"
  ].join("");
}

function expiredMcdTokenMessage(): string {
  return [
    "麦当劳 MCP token 无效或已过期。",
    "请重新在 https://open.mcd.cn/mcp 获取 token 后发送：绑定麦当劳 token Authorization: Bearer <你的麦当劳 MCP token>。",
    "不会自动下单。"
  ].join("");
}

function isAuthError(value: string): boolean {
  return /401|403|unauthorized|forbidden|token|authorization/i.test(value);
}

function stripBearer(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, "").trim();
}

function firstNonBlank(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (value?.trim()) {
      return stripBearer(value);
    }
  }
  return null;
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
    throw new Error(`${flag} must be an integer`);
  }
  return parsed;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} is missing a value`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readStdin(): Promise<string> {
  return new Promise((resolveStdin, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolveStdin(Buffer.concat(chunks).toString("utf8")));
  });
}
