import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { readConfig } from "./config.js";
import { ExternalCommandProvider } from "./providers/external-command-provider.js";
import { calculateOfferTotal } from "./pricing.js";
import { parseCoffeeCommand } from "./query-parser.js";
import { searchCoffeePrices } from "./search-service.js";
import type {
  AddressConfig,
  CoffeePriceConfig,
  OfferCandidate,
  PriceBook,
  PriceBookOffer,
  PriceBookRefreshQueryConfig
} from "./types.js";

const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";

export interface PriceBookRefreshOptions {
  configPath: string;
  outputPath?: string;
  queries: PriceBookRefreshQueryConfig[];
  outputFormat: "text" | "json";
}

export interface PriceBookRefreshSummary {
  outputPath: string;
  updatedAt: string;
  refreshedOffers: number;
  retainedOffers: number;
  warnings: string[];
}

export interface PriceBookRefreshCliResult {
  text: string;
  exitCode: number;
  summary?: PriceBookRefreshSummary;
}

export interface PriceBookRefreshDeps {
  readConfig?: (path: string) => Promise<CoffeePriceConfig>;
  now?: () => Date;
}

interface RefreshScope {
  addressAlias: string;
  normalizedDrink: string;
  size: string | null;
}

export function parsePriceBookRefreshArgs(args: string[]): PriceBookRefreshOptions {
  return {
    configPath: readOption(args, "--config") ?? DEFAULT_CONFIG_PATH,
    outputPath: readOption(args, "--out"),
    queries: readQueryOptions(args),
    outputFormat: args.includes("--json") ? "json" : "text"
  };
}

export async function runPriceBookRefreshCli(
  args: string[],
  deps: PriceBookRefreshDeps = {}
): Promise<PriceBookRefreshCliResult> {
  const options = parsePriceBookRefreshArgs(args);
  try {
    const summary = await refreshPriceBook(options, deps);
    return {
      text: options.outputFormat === "json"
        ? `${JSON.stringify(summary, null, 2)}\n`
        : formatRefreshSummary(summary),
      exitCode: 0,
      summary
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      text: `价格库刷新失败：${message}\n`,
      exitCode: 1
    };
  }
}

export async function refreshPriceBook(
  options: PriceBookRefreshOptions,
  deps: PriceBookRefreshDeps = {}
): Promise<PriceBookRefreshSummary> {
  const config = await (deps.readConfig ?? readConfig)(options.configPath);
  const outputPath = options.outputPath
    ? resolve(options.outputPath)
    : config.priceBookRefresh?.outputPath ?? config.priceBookPath;
  if (!outputPath) {
    throw new Error("没有配置 priceBookPath 或 priceBookRefresh.outputPath");
  }

  const queries = options.queries.length ? options.queries : config.priceBookRefresh?.queries ?? [];
  if (!queries.length) {
    throw new Error("没有配置刷新查询；请在 priceBookRefresh.queries 中添加 message，或传入 --query");
  }

  const externalSources = config.externalSources ?? [];
  if (!externalSources.length) {
    throw new Error("没有启用 externalSources；请接入 MCP/授权接口脚本后再刷新价格库");
  }

  const providers = externalSources.map((source) => new ExternalCommandProvider(source));
  const warnings: string[] = [];
  const refreshed: PriceBookOffer[] = [];
  const scopes: RefreshScope[] = [];

  for (const spec of queries) {
    const query = parseCoffeeCommand(spec.message);
    const result = await searchCoffeePrices({
      query: spec.addressAlias ? { ...query, addressAlias: spec.addressAlias } : query,
      config,
      providers
    });
    scopes.push({
      addressAlias: result.resolvedAddress.alias,
      normalizedDrink: result.query.normalizedDrink,
      size: result.query.size
    });
    warnings.push(...result.warnings.map((warning) => `${spec.message}: ${warning}`));
    refreshed.push(
      ...[...result.delivery, ...result.pickup].map((offer) =>
        toPriceBookOffer(offer, result.resolvedAddress)
      )
    );
  }

  const refreshedOffers = dedupeOffers(refreshed);
  if (!refreshedOffers.length) {
    throw new Error("外部源没有返回任何可比价格；已保留现有价格库不变");
  }

  const existing = await readExistingPriceBook(outputPath);
  const retained = config.priceBookRefresh?.mergeExisting === false
    ? []
    : (existing.offers ?? []).filter((offer) => !matchesAnyScope(offer, scopes));
  const updatedAt = (deps.now ?? (() => new Date()))().toISOString();
  const next: PriceBook = {
    source: "priceBook",
    updatedAt,
    offers: [...retained, ...refreshedOffers]
  };

  await writeJsonAtomic(outputPath, next);

  return {
    outputPath,
    updatedAt,
    refreshedOffers: refreshedOffers.length,
    retainedOffers: retained.length,
    warnings
  };
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function readQueryOptions(args: string[]): PriceBookRefreshQueryConfig[] {
  const queries: PriceBookRefreshQueryConfig[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--query" && args[index + 1]) {
      queries.push({ message: args[index + 1] });
      index += 1;
    }
  }
  return queries;
}

async function readExistingPriceBook(path: string): Promise<PriceBook> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as PriceBook;
  } catch {
    return { source: "priceBook", offers: [] };
  }
}

function toPriceBookOffer(offer: OfferCandidate, address: AddressConfig): PriceBookOffer {
  return {
    source: offer.source,
    addressAliases: [address.alias],
    brand: offer.brand,
    storeName: offer.storeName,
    drinkName: offer.drinkName,
    normalizedDrink: offer.normalizedDrink,
    size: offer.size,
    fulfillment: offer.fulfillment,
    itemPrice: offer.itemPrice,
    quantity: offer.quantity,
    deliveryFee: offer.deliveryFee,
    packagingFee: offer.packagingFee,
    discounts: offer.discounts,
    distanceText: offer.distanceText,
    etaText: offer.etaText,
    purchaseUrl: offer.purchaseUrl,
    totalPrice: offer.totalPrice
  };
}

function dedupeOffers(offers: PriceBookOffer[]): PriceBookOffer[] {
  const byKey = new Map<string, PriceBookOffer>();
  for (const offer of offers) {
    const key = offerIdentity(offer);
    const existing = byKey.get(key);
    if (!existing || offerTotal(offer) < offerTotal(existing)) {
      byKey.set(key, offer);
    }
  }
  return [...byKey.values()];
}

function offerTotal(offer: PriceBookOffer): number {
  return calculateOfferTotal({
    ...offer,
    quantity: offer.quantity ?? 1
  });
}

function offerIdentity(offer: PriceBookOffer): string {
  return [
    offer.addressAliases?.join(",") ?? "*",
    offer.brand,
    offer.storeName,
    offer.normalizedDrink,
    offer.size ?? "",
    offer.fulfillment,
    offer.purchaseUrl ?? ""
  ].join("|");
}

function matchesAnyScope(offer: PriceBookOffer, scopes: RefreshScope[]): boolean {
  return scopes.some((scope) => matchesScope(offer, scope));
}

function matchesScope(offer: PriceBookOffer, scope: RefreshScope): boolean {
  if (offer.normalizedDrink !== scope.normalizedDrink) {
    return false;
  }
  if ((offer.size ?? null) !== scope.size) {
    return false;
  }
  if (!offer.addressAliases?.length) {
    return true;
  }
  return offer.addressAliases.includes(scope.addressAlias);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

function formatRefreshSummary(summary: PriceBookRefreshSummary): string {
  const lines = [
    `价格库已刷新: ${summary.outputPath}`,
    `更新时间: ${summary.updatedAt}`,
    `刷新条目: ${summary.refreshedOffers}`,
    `保留旧条目: ${summary.retainedOffers}`
  ];
  if (summary.warnings.length) {
    lines.push("警告:");
    lines.push(...summary.warnings.map((warning) => `- ${warning}`));
  }
  return `${lines.join("\n")}\n`;
}
