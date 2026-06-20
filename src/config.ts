import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import type { BrandConfig, CoffeePriceConfig, SourceConfig } from "./types.js";

export const DEFAULT_BRANDS = ["瑞幸", "库迪", "星巴克", "Tims", "Manner", "M Stand", "Peet's"];

const DEFAULT_SOURCES: SourceConfig = {
  priceBook: false,
  meituan: true,
  eleme: true,
  brandOfficial: true
};

export async function readConfig(configPath: string): Promise<CoffeePriceConfig> {
  const raw = JSON.parse(stripJsonBom(await readFile(configPath, "utf8"))) as Partial<CoffeePriceConfig>;
  return resolveRuntimePaths(normalizeConfig(raw), configPath);
}

function stripJsonBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function resolveRuntimePaths(config: CoffeePriceConfig, configPath: string): CoffeePriceConfig {
  const root = inferConfigRoot(configPath);
  return {
    ...config,
    browserProfilePath: resolvePathFromRoot(root, config.browserProfilePath),
    priceBookPath: config.priceBookPath ? resolvePathFromRoot(root, config.priceBookPath) : config.priceBookPath,
    priceBookRefresh: config.priceBookRefresh
      ? {
          ...config.priceBookRefresh,
          outputPath: config.priceBookRefresh.outputPath
            ? resolvePathFromRoot(root, config.priceBookRefresh.outputPath)
            : config.priceBookPath
        }
      : config.priceBookRefresh,
    externalSources: config.externalSources?.map((source) => ({
      ...source,
      cwd: source.cwd ? resolvePathFromRoot(root, source.cwd) : root
    }))
  };
}

function inferConfigRoot(configPath: string): string {
  const configDir = dirname(resolve(configPath));
  return basename(configDir).toLowerCase() === "config" ? dirname(configDir) : configDir;
}

function resolvePathFromRoot(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

export function normalizeConfig(raw: Partial<CoffeePriceConfig>): CoffeePriceConfig {
  return {
    defaultAddressAlias: raw.defaultAddressAlias ?? raw.addresses?.[0]?.alias ?? "默认",
    addresses: raw.addresses ?? [],
    browserProfilePath: raw.browserProfilePath ?? ".runtime/browser-profile",
    openLowestPurchasePage: raw.openLowestPurchasePage ?? false,
    priceBookPath: raw.priceBookPath ?? "config/pricebook.json",
    priceBookRefresh: raw.priceBookRefresh
      ? {
          outputPath: raw.priceBookRefresh.outputPath ?? raw.priceBookPath ?? "config/pricebook.json",
          mergeExisting: raw.priceBookRefresh.mergeExisting ?? true,
          queries: raw.priceBookRefresh.queries ?? []
        }
      : undefined,
    brands: normalizeBrands(raw.brands),
    sources: { ...DEFAULT_SOURCES, ...(raw.sources ?? {}) },
    browserSources: raw.browserSources ?? {},
    externalSources: raw.externalSources?.filter((source) => source.enabled !== false) ?? []
  };
}

function normalizeBrands(brands: BrandConfig[] | undefined): BrandConfig[] {
  if (!brands?.length) {
    return DEFAULT_BRANDS.map((name) => ({ name, enabled: true }));
  }
  const seen = new Set<string>();
  const normalized = brands.map((brand) => {
    seen.add(brand.name);
    return { name: brand.name, enabled: brand.enabled !== false };
  });
  for (const name of DEFAULT_BRANDS) {
    if (!seen.has(name)) {
      normalized.push({ name, enabled: true });
    }
  }
  return normalized;
}
