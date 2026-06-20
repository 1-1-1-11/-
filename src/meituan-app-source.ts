import { fetch } from "undici";

import type { AddressConfig, CoffeeQuery, Discount, PlatformSnapshot, PlatformSnapshotOffer } from "./types.js";

interface ExternalPriceSourceRequest {
  query: CoffeeQuery;
  address: AddressConfig;
}

export interface MeituanAppSourceOptions {
  baseUrl: string;
  brands: string[];
  timeoutMs: number;
}

export interface MeituanAppSourceDeps {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

interface MeituanRestaurant {
  name?: string;
  title?: string;
  shop_name?: string;
  distance?: string | number;
  delivery_time?: string | number;
}

interface MeituanCartItem {
  name?: string;
  title?: string;
  item?: string;
  price?: string | number;
  quantity?: string | number;
}

interface MeituanCart {
  ok?: boolean;
  error?: string;
  items?: MeituanCartItem[];
  total?: string | number;
  count?: string | number;
  cart_total?: string | number;
}

interface MeituanCheckout {
  ok?: boolean;
  error?: string;
  suggestion?: string;
  address?: string;
  total?: string | number;
  cart_total?: string | number;
  item_total?: string | number;
  goods_total?: string | number;
  delivery_fee?: string | number;
  deliveryFee?: string | number;
  packaging_fee?: string | number;
  packagingFee?: string | number;
  discount?: string | number;
  discounts?: Array<{ label?: string; name?: string; amount?: string | number }>;
  delivery_time?: string | number;
  deliveryTime?: string | number;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:18080";
const DEFAULT_BRANDS = ["瑞幸", "库迪", "星巴克", "Tims", "Manner", "M Stand", "Peet's"];

export function parseMeituanAppSourceArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): MeituanAppSourceOptions {
  const options: MeituanAppSourceOptions = {
    baseUrl: env.MEITUAN_APP_BASE_URL ?? DEFAULT_BASE_URL,
    brands: splitCsv(env.MEITUAN_APP_BRANDS) ?? DEFAULT_BRANDS,
    timeoutMs: parseInteger(env.MEITUAN_APP_TIMEOUT_MS) ?? 120_000
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--base-url") {
      options.baseUrl = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--brands") {
      options.brands = splitCsv(requireValue(arg, next)) ?? DEFAULT_BRANDS;
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = parseRequiredInteger(arg, next);
      index += 1;
    }
  }

  return options;
}

export async function runMeituanAppSourceCli(
  args: string[],
  deps: MeituanAppSourceDeps = {}
): Promise<{ text: string; exitCode: number; snapshot: PlatformSnapshot }> {
  const options = parseMeituanAppSourceArgs(args, deps.env);
  const stdin = deps.stdin ?? (await readStdin());
  const request = JSON.parse(stdin) as ExternalPriceSourceRequest;
  const snapshot = await buildMeituanAppSnapshot(request, options, deps);
  return {
    text: `${JSON.stringify(snapshot)}\n`,
    exitCode: 0,
    snapshot
  };
}

export async function buildMeituanAppSnapshot(
  request: ExternalPriceSourceRequest,
  options: MeituanAppSourceOptions,
  deps: MeituanAppSourceDeps = {}
): Promise<PlatformSnapshot> {
  const client = new MeituanAppClient(options, deps.fetch ?? fetch);
  const offers: PlatformSnapshotOffer[] = [];
  const failures: string[] = [];

  for (const brand of options.brands) {
    try {
      const offer = await quoteBrand(client, brand, request);
      if (offer) {
        offers.push(offer);
      }
    } catch (error) {
      failures.push(`${brand}: ${error instanceof Error ? error.message : String(error)}`);
      await client.tryReset();
    }
  }

  if (offers.length) {
    return {
      source: "meituanApp",
      message: failures.length ? failures.join("；") : undefined,
      offers
    };
  }

  return {
    source: "meituanApp",
    status: failures.length ? "unavailable" : "no_stock",
    message: failures.length ? failures.join("；") : "美团 App 自动化源没有找到可比咖啡"
  };
}

async function quoteBrand(
  client: MeituanAppClient,
  brand: string,
  request: ExternalPriceSourceRequest
): Promise<PlatformSnapshotOffer | null> {
  await client.optionalGet("/launch");
  const search = await client.get("/search", { keyword: brand });
  const restaurants = extractArray<MeituanRestaurant>(search, "restaurants");
  if (!restaurants.length && search.ok === false) {
    throw new Error(extractError(search));
  }
  const restaurant = restaurants[0] ?? {};
  await client.get("/open", { target: "0" });
  await client.get("/tap", { keyword: "外卖" });
  const itemKeyword = buildItemKeyword(request.query);
  await client.get("/type", { text: itemKeyword });
  await client.post("/add_to_cart", { item: itemKeyword });
  const cart = await client.get("/cart") as MeituanCart;
  const checkout = await client.get("/checkout") as MeituanCheckout;
  if (checkout.ok === false) {
    throw new Error(extractError(checkout));
  }
  return toOffer(brand, restaurant, cart, checkout, request.query);
}

function toOffer(
  brand: string,
  restaurant: MeituanRestaurant,
  cart: MeituanCart,
  checkout: MeituanCheckout,
  query: CoffeeQuery
): PlatformSnapshotOffer {
  const itemTotal =
    parseMoney(checkout.item_total) ??
    parseMoney(checkout.goods_total) ??
    parseMoney(cart.cart_total) ??
    parseMoney(cart.total) ??
    sumCartItems(cart.items) ??
    parseMoney(checkout.total) ??
    0;
  const total =
    parseMoney(checkout.total) ??
    parseMoney(checkout.cart_total) ??
    itemTotal;
  const deliveryFee = parseMoney(checkout.delivery_fee) ?? parseMoney(checkout.deliveryFee);
  const packagingFee = parseMoney(checkout.packaging_fee) ?? parseMoney(checkout.packagingFee);
  const discounts = extractDiscounts(checkout);

  return {
    source: "meituanApp",
    brand,
    storeName: restaurant.name ?? restaurant.title ?? restaurant.shop_name ?? `${brand} 美团门店`,
    drinkName: pickCartDrinkName(cart.items) ?? query.drink,
    normalizedDrink: query.normalizedDrink,
    size: query.size,
    fulfillment: "delivery",
    itemPrice: roundCurrency(itemTotal / Math.max(1, query.quantity)),
    quantity: query.quantity,
    deliveryFee: deliveryFee ?? 0,
    packagingFee: packagingFee ?? 0,
    discounts,
    distanceText: formatOptional(restaurant.distance) ?? formatOptional(checkout.address),
    etaText: formatOptional(checkout.delivery_time ?? checkout.deliveryTime ?? restaurant.delivery_time),
    totalPrice: roundCurrency(total)
  };
}

class MeituanAppClient {
  constructor(
    private readonly options: MeituanAppSourceOptions,
    private readonly fetchImpl: typeof fetch
  ) {}

  async get(path: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    return this.request("GET", path, params);
  }

  async optionalGet(path: string): Promise<void> {
    try {
      await this.get(path);
    } catch {
      // Older meituan-cli versions may not expose /launch; search can still work.
    }
  }

  async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("POST", path, {}, body);
  }

  async tryReset(): Promise<void> {
    try {
      await this.get("/back");
      await this.get("/back");
    } catch {
      // Keep the original quote failure; reset is best-effort only.
    }
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string> = {},
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.options.timeoutMs);
    try {
      const url = new URL(path, this.options.baseUrl.endsWith("/") ? this.options.baseUrl : `${this.options.baseUrl}/`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
      const response = await this.fetchImpl(url, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: abort.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 300) || response.statusText}`);
      }
      const parsed = text ? JSON.parse(text) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${path} did not return a JSON object`);
      }
      const object = parsed as Record<string, unknown>;
      if (object.ok === false) {
        throw new Error(extractError(object));
      }
      return object;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`${method} ${path} timed out after ${this.options.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildItemKeyword(query: CoffeeQuery): string {
  return [query.drink, query.size].filter(Boolean).join(" ");
}

function extractArray<T>(payload: Record<string, unknown>, key: string): T[] {
  const value = payload[key];
  return Array.isArray(value) ? value as T[] : [];
}

function extractDiscounts(checkout: MeituanCheckout): Discount[] {
  const discounts: Discount[] = [];
  if (Array.isArray(checkout.discounts)) {
    for (const discount of checkout.discounts) {
      const amount = parseMoney(discount.amount);
      if (amount && amount > 0) {
        discounts.push({ label: discount.label ?? discount.name ?? "平台优惠", amount });
      }
    }
  }
  const aggregate = parseMoney(checkout.discount);
  if (aggregate && aggregate > 0 && !discounts.length) {
    discounts.push({ label: "平台优惠", amount: aggregate });
  }
  return discounts;
}

function sumCartItems(items: MeituanCartItem[] | undefined): number | null {
  if (!items?.length) {
    return null;
  }
  const total = items.reduce((sum, item) => {
    const price = parseMoney(item.price) ?? 0;
    const quantity = parseMoney(item.quantity) ?? 1;
    return sum + price * quantity;
  }, 0);
  return total > 0 ? roundCurrency(total) : null;
}

function pickCartDrinkName(items: MeituanCartItem[] | undefined): string | null {
  const item = items?.[0];
  return item?.name ?? item?.title ?? item?.item ?? null;
}

function extractError(value: { error?: unknown; suggestion?: unknown }): string {
  return String(value.error ?? value.suggestion ?? "美团 App 自动化服务返回失败");
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

function formatOptional(value: string | number | undefined | null): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return String(value);
}

function splitCsv(value: string | undefined): string[] | null {
  if (!value) {
    return null;
  }
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? values : null;
}

function parseInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRequiredInteger(flag: string, value: string | undefined): number {
  const parsed = parseInteger(requireValue(flag, value));
  if (parsed === null) {
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

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
