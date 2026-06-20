import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { parseLuckinMcpSourceArgs, resolveLuckinToken, type LuckinMcpSourceOptions } from "./luckin-mcp-source.js";
import { roundCurrency } from "./pricing.js";
import type { AddressConfig, CoffeeQuery, PlatformSnapshot, PlatformSnapshotOffer } from "./types.js";

interface ExternalPriceSourceRequest {
  query: CoffeeQuery;
  address: AddressConfig;
}

export interface LuckinOfficialSourceOptions extends LuckinMcpSourceOptions {
  cliPath: string;
  timeoutMs: number;
}

export interface LuckinOfficialSourceDeps {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  runCommand?: (
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; timeoutMs: number }
  ) => Promise<OfficialCliCommandResult>;
  platform?: NodeJS.Platform;
  cwd?: string;
}

export interface OfficialCliCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface OfficialStore {
  deptId: string;
  deptName?: string;
  address?: string;
  distance?: string | number;
}

interface OfficialProduct {
  productId: string;
  productName?: string;
  name?: string;
  skuCode: string;
  initialPrice?: string | number;
  estimatePrice?: string | number;
}

interface OfficialPreview {
  totalInitialPrice?: string | number;
  privilegeMoney?: string | number;
  discountPrice?: string | number;
  aboutTime?: string | number;
  purchaseUrl?: string;
  productInfoList?: Array<{
    initPrice?: string | number;
    initialPrice?: string | number;
    estimatePrice?: string | number;
    estimateTotalPrice?: string | number;
  }>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const AUTH_ERROR_PATTERN =
  /未配置鉴权|鉴权.*(?:失败|无效)|token.*(?:invalid|expired|missing)|Token.*(?:过期|无效)|LUCKIN_MCP_ORDER_TOKEN|LUCKIN_MCP_TOKEN|luckin_mcp_token_invalid|HTTP\s*401|401\s*(?:Unauthorized)?|重新获取\s*Token|请执行\s*luckin login|\/login\s*获取\s*Token/i;

const STORE_ARRAY_KEYS = ["shopList", "shops", "storeList", "stores", "list", "records", "data"];
const PRODUCT_ARRAY_KEYS = ["productInfoList", "productList", "products", "menu", "menus", "items", "list", "records", "data"];

export function parseLuckinOfficialSourceArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  cwd: string = process.cwd()
): LuckinOfficialSourceOptions {
  const base = parseLuckinMcpSourceArgs(args, env);
  const options: LuckinOfficialSourceOptions = {
    ...base,
    cliPath: env.LUCKIN_OFFICIAL_CLI_PATH ?? env.LUCKIN_CLI_PATH ?? defaultLuckinCliPath(platform, cwd),
    timeoutMs: parseOptionalInteger(env.LUCKIN_OFFICIAL_SOURCE_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--cli-path":
        options.cliPath = requireValue(arg, next);
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

export async function runLuckinOfficialSourceCli(
  args: string[],
  deps: LuckinOfficialSourceDeps = {}
): Promise<{ text: string; exitCode: number; snapshot: PlatformSnapshot }> {
  const options = parseLuckinOfficialSourceArgs(
    args,
    deps.env,
    deps.platform ?? process.platform,
    deps.cwd ?? process.cwd()
  );
  const stdin = deps.stdin ?? (await readStdin());
  const request = JSON.parse(stdin) as ExternalPriceSourceRequest;
  const snapshot = await buildLuckinOfficialSnapshot(request, options, deps);
  return {
    text: `${JSON.stringify(snapshot)}\n`,
    exitCode: 0,
    snapshot
  };
}

export async function buildLuckinOfficialSnapshot(
  request: ExternalPriceSourceRequest,
  options: LuckinOfficialSourceOptions,
  deps: LuckinOfficialSourceDeps = {}
): Promise<PlatformSnapshot> {
  const resolvedToken = await resolveLuckinToken(options, deps);
  if (!resolvedToken?.token) {
    return statusSnapshot(
      "login_required",
      "缺少 LUCKIN_MCP_ORDER_TOKEN；请运行 npm run luckin:official-login 完成官方 CLI 登录。"
    );
  }

  const longitude = options.longitude ?? request.address.longitude;
  const latitude = options.latitude ?? request.address.latitude;
  if (!isFiniteNumber(longitude) || !isFiniteNumber(latitude)) {
    return statusSnapshot("unavailable", "瑞幸官方 CLI 需要经纬度；请在地址配置中填写 longitude 和 latitude。");
  }

  const commandEnv = {
    ...(deps.env ?? process.env),
    LUCKIN_MCP_ORDER_TOKEN: resolvedToken.token,
    LUCKIN_MCP_TOKEN: resolvedToken.token
  };
  const runCli = (args: string[]) =>
    (deps.runCommand ?? runOfficialCliCommand)(options.cliPath, args, {
      env: commandEnv,
      timeoutMs: options.timeoutMs
    });

  const storeResult = await runCli(["store", String(latitude), String(longitude)]);
  const storeStatus = commandStatus(storeResult, "瑞幸官方 CLI 门店查询失败");
  if (storeStatus) {
    return storeStatus;
  }

  const stores = parseStores(storeResult.stdout);
  if (!stores.length) {
    return statusSnapshot("no_stock", "瑞幸官方 CLI 没有返回附近可用门店。");
  }

  const offers: PlatformSnapshotOffer[] = [];
  const failures: string[] = [];
  const productTerms = buildProductQuery(request.query).split(/\s+/).filter(Boolean);
  for (const store of stores.slice(0, Math.max(1, options.maxShops))) {
    const productResult = await runCli(["product", store.deptId, ...productTerms]);
    const productStatus = commandStatus(productResult, `瑞幸官方 CLI 商品查询失败（${store.deptName ?? store.deptId}）`);
    if (productStatus?.status === "login_required") {
      return productStatus;
    }
    if (productStatus) {
      failures.push(productStatus.message ?? `${store.deptId}: 商品查询失败`);
      continue;
    }

    let products = parseProducts(productResult.stdout);
    if (!products.length) {
      const menuResult = await runCli(["menu", store.deptId, ...productTerms]);
      const menuStatus = commandStatus(menuResult, `瑞幸官方 CLI 菜单查询失败（${store.deptName ?? store.deptId}）`);
      if (menuStatus?.status === "login_required") {
        return menuStatus;
      }
      if (menuStatus) {
        failures.push(menuStatus.message ?? `${store.deptId}: 菜单查询失败`);
        continue;
      }
      products = parseProducts(menuResult.stdout);
    }

    const product = pickBestProduct(products, request.query);
    if (!product) {
      failures.push(`${store.deptName ?? store.deptId}: 没有匹配 ${request.query.drink}`);
      continue;
    }

    const previewResult = await runCli([
      "order",
      "preview",
      store.deptId,
      "--product",
      `${product.productId}:${product.skuCode}:${request.query.quantity}`
    ]);
    const previewStatus = commandStatus(previewResult, `瑞幸官方 CLI 预览订单失败（${store.deptName ?? store.deptId}）`);
    if (previewStatus?.status === "login_required") {
      return previewStatus;
    }
    if (previewStatus) {
      failures.push(previewStatus.message ?? `${store.deptId}: 预览失败`);
      continue;
    }

    const preview = parsePreview(previewResult.stdout);
    offers.push(toPickupOffer(store, product, preview, request.query));
  }

  if (offers.length) {
    return {
      source: "luckinMcp",
      message: failures.length ? failures.join("；") : undefined,
      offers
    };
  }

  return statusSnapshot(
    failures.length ? "unavailable" : "no_stock",
    failures.length ? failures.join("；") : "瑞幸官方 CLI 没有返回可比商品或价格预览。"
  );
}

function defaultLuckinCliPath(platform: NodeJS.Platform, cwd: string): string {
  return resolve(cwd, ".runtime", "luckin-official-cli", "extract", platform === "win32" ? "luckin.exe" : "luckin");
}

function commandStatus(result: OfficialCliCommandResult, label: string): PlatformSnapshot | null {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (isAuthError(output)) {
    return statusSnapshot("login_required", `${label}：登录态失效或 token 无效，请重新运行 npm run luckin:official-login。`);
  }
  if (result.exitCode !== 0) {
    return statusSnapshot("unavailable", `${label}：${output.slice(0, 300) || `退出码 ${result.exitCode}`}`);
  }
  return null;
}

function isAuthError(value: string): boolean {
  return AUTH_ERROR_PATTERN.test(value);
}

function parseStores(text: string): OfficialStore[] {
  const rows = extractRows(text, STORE_ARRAY_KEYS);
  return rows.map(normalizeStore).filter((store): store is OfficialStore => Boolean(store?.deptId));
}

function parseProducts(text: string): OfficialProduct[] {
  const rows = extractRows(text, PRODUCT_ARRAY_KEYS);
  return rows.map(normalizeProduct).filter((product): product is OfficialProduct =>
    Boolean(product?.productId && product.skuCode)
  );
}

function parsePreview(text: string): OfficialPreview {
  const jsonValues = extractJsonValues(text);
  for (const value of jsonValues) {
    const object = findObjectWithAliases(value, [
      "discountPrice",
      "payPrice",
      "totalPrice",
      "actualPrice",
      "应付",
      "实付",
      "到手价"
    ]);
    if (object) {
      return normalizePreview(object);
    }
  }
  const tableRow = parsePipeTables(text)[0]?.[0];
  return tableRow ? normalizePreview(tableRow) : {};
}

function extractRows(text: string, arrayKeys: string[]): Record<string, unknown>[] {
  const jsonValues = extractJsonValues(text);
  for (const value of jsonValues) {
    const rows = findArrays(value, arrayKeys);
    if (rows.length) {
      return rows;
    }
  }
  return parsePipeTables(text).flat();
}

function normalizeStore(row: Record<string, unknown>): OfficialStore | null {
  const deptId = readString(row, ["deptId", "deptID", "shopId", "storeId", "id", "门店ID", "门店id"]);
  if (!deptId) {
    return null;
  }
  return {
    deptId,
    deptName: readString(row, ["deptName", "shopName", "storeName", "name", "门店名称", "门店"]) ?? undefined,
    address: readString(row, ["address", "addr", "地址"]) ?? undefined,
    distance: readRaw(row, ["distance", "distanceText", "距离"]) as string | number | undefined
  };
}

function normalizeProduct(row: Record<string, unknown>): OfficialProduct | null {
  const skuRow = firstNestedObject(row, ["skuList", "skus", "skuInfoList", "sku"]);
  const productId = readString(row, ["productId", "goodsId", "id", "商品ID", "商品id"]);
  const skuCode = readString(row, ["skuCode", "skuNo", "skuId", "sku", "SKU", "sku编码"]) ??
    (skuRow ? readString(skuRow, ["skuCode", "skuNo", "skuId", "sku", "SKU", "sku编码"]) : null);
  if (!productId || !skuCode) {
    return null;
  }
  return {
    productId,
    productName:
      readString(row, ["productName", "goodsName", "title", "name", "商品名称", "名称"]) ??
      (skuRow ? readString(skuRow, ["productName", "skuName", "name", "名称"]) : undefined) ??
      undefined,
    name: readString(row, ["name", "title", "名称"]) ?? undefined,
    skuCode,
    initialPrice:
      readNumberish(row, ["initialPrice", "originalPrice", "initPrice", "price", "原价", "价格", "商品原价"]) ??
      (skuRow ? readNumberish(skuRow, ["initialPrice", "originalPrice", "initPrice", "price", "原价", "价格"]) : undefined),
    estimatePrice:
      readNumberish(row, ["estimatePrice", "salePrice", "discountPrice", "couponPrice", "券后价", "预估价", "到手价"]) ??
      (skuRow ? readNumberish(skuRow, ["estimatePrice", "salePrice", "discountPrice", "券后价", "到手价"]) : undefined)
  };
}

function normalizePreview(row: Record<string, unknown>): OfficialPreview {
  return {
    totalInitialPrice: readNumberish(row, [
      "totalInitialPrice",
      "originalPrice",
      "initPrice",
      "itemTotal",
      "subtotal",
      "商品总价",
      "原价"
    ]),
    privilegeMoney: readNumberish(row, ["privilegeMoney", "discount", "discountAmount", "优惠", "优惠金额"]),
    discountPrice: readNumberish(row, [
      "discountPrice",
      "payPrice",
      "totalPrice",
      "actualPrice",
      "price",
      "应付",
      "实付",
      "到手价"
    ]),
    aboutTime: readNumberish(row, ["aboutTime", "eta", "pickupTime", "预计时间", "取餐时间"]),
    purchaseUrl: readString(row, ["pay_order_url", "payOrderUrl", "purchaseUrl", "url", "购买链接", "下单链接"]) ?? undefined,
    productInfoList: extractNestedArray(row, ["productInfoList", "productList", "products"]) as OfficialPreview["productInfoList"]
  };
}

function pickBestProduct(products: OfficialProduct[], query: CoffeeQuery): OfficialProduct | null {
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
  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.score === 0 && query.drink ? scored[0]?.product ?? null : scored[0]?.product ?? null;
}

function toPickupOffer(
  store: OfficialStore,
  product: OfficialProduct,
  preview: OfficialPreview,
  query: CoffeeQuery
): PlatformSnapshotOffer {
  const productInfo = preview.productInfoList?.[0];
  const totalInitial =
    parseMoney(preview.totalInitialPrice) ??
    parseMoney(productInfo?.estimateTotalPrice) ??
    parseMoney(productInfo?.initialPrice) ??
    parseMoney(productInfo?.initPrice) ??
    multiplyUnitPrice(product.initialPrice, query.quantity) ??
    multiplyUnitPrice(product.estimatePrice, query.quantity) ??
    0;
  const discountPrice =
    parseMoney(preview.discountPrice) ??
    parseMoney(productInfo?.estimateTotalPrice) ??
    multiplyUnitPrice(productInfo?.estimatePrice, query.quantity) ??
    multiplyUnitPrice(product.estimatePrice, query.quantity) ??
    totalInitial;
  const discount =
    parseMoney(preview.privilegeMoney) ?? roundCurrency(Math.max(0, totalInitial - discountPrice));

  return {
    source: "luckinMcp",
    brand: "瑞幸",
    storeName: store.deptName ?? store.address ?? "瑞幸门店",
    drinkName: product.productName ?? product.name ?? query.drink,
    normalizedDrink: query.normalizedDrink,
    size: query.size,
    fulfillment: "pickup",
    itemPrice: roundCurrency(totalInitial / Math.max(1, query.quantity)),
    quantity: query.quantity,
    discounts: discount > 0 ? [{ label: "瑞幸官方 CLI 预览优惠", amount: discount }] : [],
    distanceText: formatDistance(store.distance),
    etaText: formatAboutTime(preview.aboutTime),
    purchaseUrl: preview.purchaseUrl,
    totalPrice: roundCurrency(discountPrice)
  };
}

function buildProductQuery(query: CoffeeQuery): string {
  return [query.temperature, query.drink, query.size].filter(Boolean).join(" ") || query.rawText;
}

function extractJsonValues(text: string): unknown[] {
  const values: unknown[] = [];
  const candidates = [text.trim(), ...extractFencedJson(text), ...extractBalancedJson(text)];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      values.push(JSON.parse(candidate));
    } catch {
      // CLI output is often human text; table parsing handles that path.
    }
  }
  return values;
}

function extractFencedJson(text: string): string[] {
  return [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim());
}

function extractBalancedJson(text: string): string[] {
  const snippets: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const opener = text[index];
    if (opener !== "{" && opener !== "[") {
      continue;
    }
    const closer = opener === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = index; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === opener) {
        depth += 1;
      } else if (char === closer) {
        depth -= 1;
        if (depth === 0) {
          snippets.push(text.slice(index, cursor + 1));
          index = cursor;
          break;
        }
      }
    }
  }
  return snippets;
}

function findArrays(value: unknown, arrayKeys: string[]): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) {
    return [];
  }
  for (const [key, entry] of Object.entries(value)) {
    if (matchesAlias(key, arrayKeys) && Array.isArray(entry)) {
      return entry.filter(isRecord);
    }
  }
  for (const entry of Object.values(value)) {
    const nested = findArrays(entry, arrayKeys);
    if (nested.length) {
      return nested;
    }
  }
  return [];
}

function findObjectWithAliases(value: unknown, aliases: string[]): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findObjectWithAliases(entry, aliases);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  if (Object.keys(value).some((key) => matchesAlias(key, aliases))) {
    return value;
  }
  for (const entry of Object.values(value)) {
    const nested = findObjectWithAliases(entry, aliases);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function parsePipeTables(text: string): Array<Array<Record<string, string>>> {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes("|"));
  const tables: Array<Array<Record<string, string>>> = [];
  let index = 0;
  while (index < lines.length) {
    const header = splitPipeRow(lines[index]);
    index += 1;
    if (!header.length) {
      continue;
    }
    if (index < lines.length && splitPipeRow(lines[index]).every((cell) => /^:?-{3,}:?$/.test(cell))) {
      index += 1;
    }
    const rows: Array<Record<string, string>> = [];
    while (index < lines.length) {
      const cells = splitPipeRow(lines[index]);
      if (cells.length !== header.length) {
        break;
      }
      rows.push(Object.fromEntries(header.map((key, cellIndex) => [key, cells[cellIndex]])));
      index += 1;
    }
    if (rows.length) {
      tables.push(rows);
    }
  }
  return tables;
}

function splitPipeRow(line: string): string[] {
  const trimmed = line.replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim()).filter((cell) => cell.length > 0);
}

function firstNestedObject(row: Record<string, unknown>, aliases: string[]): Record<string, unknown> | null {
  const nested = extractNestedArray(row, aliases)?.[0];
  return isRecord(nested) ? nested : null;
}

function extractNestedArray(row: Record<string, unknown>, aliases: string[]): unknown[] | null {
  for (const [key, value] of Object.entries(row)) {
    if (!matchesAlias(key, aliases)) {
      continue;
    }
    if (Array.isArray(value)) {
      return value;
    }
    if (isRecord(value)) {
      return [value];
    }
  }
  return null;
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
    if (matchesAlias(key, aliases)) {
      return value;
    }
  }
  return undefined;
}

function readNumberish(row: Record<string, unknown>, aliases: string[]): string | number | undefined {
  const value = readRaw(row, aliases);
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function matchesAlias(key: string, aliases: string[]): boolean {
  const normalizedKey = normalizeKey(key);
  return aliases.some((alias) => normalizeKey(alias) === normalizedKey);
}

function normalizeKey(key: string): string {
  return key.replace(/[\s_\-:：]/g, "").toLowerCase();
}

function multiplyUnitPrice(value: string | number | undefined, quantity: number): number | null {
  const parsed = parseMoney(value);
  return parsed === null ? null : roundCurrency(parsed * Math.max(1, quantity));
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

function formatDistance(distance: string | number | undefined): string | undefined {
  const parsed = parseMoney(distance);
  if (parsed === null) {
    return typeof distance === "string" ? distance : undefined;
  }
  if (typeof distance === "string" && /m|米|km|公里/i.test(distance)) {
    return distance;
  }
  return `${roundCurrency(parsed)}km`;
}

function formatAboutTime(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return value;
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

function statusSnapshot(status: "login_required" | "no_stock" | "unavailable", message: string): PlatformSnapshot {
  return {
    source: "luckinMcp",
    status,
    message
  };
}

function runOfficialCliCommand(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number }
): Promise<OfficialCliCommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      env: options.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      resolveResult({
        exitCode: 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: error.message
      });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolveResult({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
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
