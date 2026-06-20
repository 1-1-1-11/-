import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { normalizeConfig } from "./config.js";
import { scaffoldBrowserSources } from "./config-scaffold.js";
import type { CoffeePriceConfig, SourceConfig } from "./types.js";

export interface ConfigSetUrlCliOptions {
  configPath: string;
  source: keyof SourceConfig;
  url: string;
  write: boolean;
}

export interface ConfigSetUrlResult {
  config: CoffeePriceConfig;
  addedSource: boolean;
}

const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";
const SOURCE_KEYS = ["meituan", "eleme", "brandOfficial"] as const;

export function setBrowserSourceEntryUrl(
  config: CoffeePriceConfig,
  source: keyof SourceConfig,
  url: string
): ConfigSetUrlResult {
  const entryUrl = validateHttpUrl(url);
  const normalized = normalizeConfig(config);
  const browserSources = { ...(normalized.browserSources ?? {}) };
  const addedSource = !browserSources[source];
  const enabledConfig: CoffeePriceConfig = {
    ...normalized,
    sources: {
      ...normalized.sources,
      [source]: true
    },
    browserSources
  };

  const scaffolded = addedSource ? scaffoldBrowserSources(enabledConfig).config : enabledConfig;
  const existingSpec = scaffolded.browserSources?.[source];
  if (!existingSpec) {
    throw new Error(`Unable to scaffold browser source: ${source}`);
  }

  return {
    config: {
      ...scaffolded,
      browserSources: {
        ...(scaffolded.browserSources ?? {}),
        [source]: {
          ...existingSpec,
          entryUrl
        }
      }
    },
    addedSource
  };
}

export function parseConfigSetUrlCliArgs(args: string[]): ConfigSetUrlCliOptions {
  const sourceValue = readOption(args, "--source");
  const url = readOption(args, "--url");
  if (!sourceValue || !url) {
    throw new Error(usage());
  }

  return {
    configPath: readOption(args, "--config") ?? DEFAULT_CONFIG_PATH,
    source: parseSource(sourceValue),
    url,
    write: args.includes("--write")
  };
}

export async function runConfigSetUrlCli(args: string[]): Promise<string> {
  const options = parseConfigSetUrlCliArgs(args);
  const raw = JSON.parse(stripJsonBom(await readFile(options.configPath, "utf8"))) as Partial<CoffeePriceConfig>;
  const result = setBrowserSourceEntryUrl(normalizeConfig(raw), options.source, options.url);
  const json = `${JSON.stringify(result.config, null, 2)}\n`;

  if (options.write) {
    await writeFile(options.configPath, json, "utf8");
    return `Updated ${options.configPath}; ${options.source} URL set; added source template: ${result.addedSource ? "yes" : "no"}`;
  }

  return [
    `${options.source} URL set; added source template: ${result.addedSource ? "yes" : "no"}`,
    "Preview only. Add --write to update the config file.",
    json.trimEnd()
  ].join("\n");
}

function validateHttpUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Browser source URL must be an absolute http/https URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Browser source URL must use http/https");
  }
  return trimmed;
}

function parseSource(value: string): keyof SourceConfig {
  if ((SOURCE_KEYS as readonly string[]).includes(value)) {
    return value as keyof SourceConfig;
  }
  throw new Error(`Unsupported source: ${value}`);
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function stripJsonBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function usage(): string {
  return [
    "Usage: npm run config:set-url -- --source meituan --url <url>",
    "Options:",
    "  --config <path>      Default config/coffee-price.config.json",
    "  --source <source>    meituan | eleme | brandOfficial",
    "  --url <url>          Absolute http/https page URL",
    "  --write              Update the config file"
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(await runConfigSetUrlCli(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
