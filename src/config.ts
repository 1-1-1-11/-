import { readFile } from "node:fs/promises";

import type { BrandConfig, CoffeePriceConfig, SourceConfig } from "./types.js";

export const DEFAULT_BRANDS = ["瑞幸", "库迪", "星巴克", "Tims", "Manner", "M Stand", "Peet's"];

const DEFAULT_SOURCES: SourceConfig = {
  meituan: true,
  eleme: true,
  brandOfficial: true
};

export async function readConfig(configPath: string): Promise<CoffeePriceConfig> {
  const raw = JSON.parse(await readFile(configPath, "utf8")) as Partial<CoffeePriceConfig>;
  return normalizeConfig(raw);
}

export function normalizeConfig(raw: Partial<CoffeePriceConfig>): CoffeePriceConfig {
  return {
    defaultAddressAlias: raw.defaultAddressAlias ?? raw.addresses?.[0]?.alias ?? "默认",
    addresses: raw.addresses ?? [],
    browserProfilePath: raw.browserProfilePath ?? ".runtime/browser-profile",
    brands: normalizeBrands(raw.brands),
    sources: { ...DEFAULT_SOURCES, ...(raw.sources ?? {}) }
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
