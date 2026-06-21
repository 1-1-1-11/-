import { readFile, writeFile } from "node:fs/promises";

import type { CoffeePriceConfig, ExternalSourceConfig } from "./types.js";

export interface McdEnableOptions {
  configPath: string;
  dryRun: boolean;
}

export interface McdEnableResult {
  configPath: string;
  changed: boolean;
  text: string;
}

export interface McdEnableDeps {
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile?: (path: string, content: string, encoding: BufferEncoding) => Promise<void>;
}

const DEFAULT_MCD_SOURCE: ExternalSourceConfig = {
  id: "mcdOfficial",
  label: "麦当劳官方 MCP",
  enabled: true,
  type: "command",
  command: "node",
  args: ["--import", "tsx", "src/mcd-official-source-cli.ts"],
  timeoutMs: 120_000
};

export async function enableMcdOfficialSource(
  options: McdEnableOptions,
  deps: McdEnableDeps = {}
): Promise<McdEnableResult> {
  const reader = deps.readFile ?? readFile;
  const writer = deps.writeFile ?? writeFile;
  const config = JSON.parse(stripJsonBom(await reader(options.configPath, "utf8"))) as Partial<CoffeePriceConfig>;
  const before = JSON.stringify(config.externalSources ?? []);
  config.externalSources = upsertMcdOfficialSource(config.externalSources);
  config.brands = upsertBrand(config.brands);
  const changed = JSON.stringify(config.externalSources ?? []) !== before;

  if (!options.dryRun && changed) {
    await writer(options.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  return {
    configPath: options.configPath,
    changed,
    text: `${changed ? "已启用" : "已经启用"} mcdOfficial：${options.configPath}`
  };
}

function upsertMcdOfficialSource(
  externalSources: ExternalSourceConfig[] | undefined
): ExternalSourceConfig[] {
  const sources = [...(externalSources ?? [])];
  const index = sources.findIndex((source) => source.id === "mcdOfficial");
  if (index === -1) {
    return [...sources, DEFAULT_MCD_SOURCE];
  }
  sources[index] = {
    ...DEFAULT_MCD_SOURCE,
    ...sources[index],
    enabled: true,
    label: sources[index].label ?? DEFAULT_MCD_SOURCE.label,
    type: sources[index].type ?? DEFAULT_MCD_SOURCE.type,
    command: sources[index].command ?? DEFAULT_MCD_SOURCE.command,
    args: sources[index].args ?? DEFAULT_MCD_SOURCE.args,
    timeoutMs: sources[index].timeoutMs ?? DEFAULT_MCD_SOURCE.timeoutMs
  };
  return sources;
}

function upsertBrand(brands: CoffeePriceConfig["brands"] | undefined): CoffeePriceConfig["brands"] | undefined {
  if (!brands) {
    return brands;
  }
  if (brands.some((brand) => brand.name === "麦咖啡")) {
    return brands.map((brand) => brand.name === "麦咖啡" ? { ...brand, enabled: true } : brand);
  }
  return [...brands, { name: "麦咖啡", enabled: true }];
}

function stripJsonBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}
