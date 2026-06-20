import { readFile, writeFile } from "node:fs/promises";

import type { CoffeePriceConfig, ExternalSourceConfig } from "./types.js";

export interface LuckinEnableOptions {
  configPath: string;
  dryRun: boolean;
}

export interface LuckinEnableResult {
  configPath: string;
  changed: boolean;
  text: string;
}

export interface LuckinEnableDeps {
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile?: (path: string, content: string, encoding: BufferEncoding) => Promise<void>;
}

const DEFAULT_LUCKIN_SOURCE: ExternalSourceConfig = {
  id: "luckinMcp",
  label: "瑞幸官方 CLI",
  enabled: true,
  command: "node",
  args: ["--import", "tsx", "src/luckin-official-source-cli.ts"],
  timeoutMs: 120000
};

export function parseLuckinEnableArgs(args: string[]): LuckinEnableOptions {
  const options: LuckinEnableOptions = {
    configPath: "config/coffee-price.config.json",
    dryRun: args.includes("--dry-run")
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--config") {
      if (!next) {
        throw new Error("--config 缺少参数值");
      }
      options.configPath = next;
      index += 1;
    }
  }

  return options;
}

export async function runLuckinEnableCli(
  args: string[],
  deps: LuckinEnableDeps = {}
): Promise<{ text: string; exitCode: number; result: LuckinEnableResult }> {
  const result = await enableLuckinMcp(parseLuckinEnableArgs(args), deps);
  return {
    text: `${result.text}\n`,
    exitCode: 0,
    result
  };
}

export async function enableLuckinMcp(
  options: LuckinEnableOptions,
  deps: LuckinEnableDeps = {}
): Promise<LuckinEnableResult> {
  const reader = deps.readFile ?? readFile;
  const writer = deps.writeFile ?? writeFile;
  const raw = await reader(options.configPath, "utf8");
  const config = JSON.parse(stripJsonBom(raw)) as Partial<CoffeePriceConfig>;
  const before = JSON.stringify(config.externalSources ?? []);
  config.externalSources = upsertLuckinSource(config.externalSources);
  const changed = JSON.stringify(config.externalSources) !== before;

  if (!options.dryRun && changed) {
    await writer(options.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  const action = options.dryRun
    ? changed
      ? "将启用 luckinMcp"
      : "luckinMcp 已经启用"
    : changed
      ? "已启用 luckinMcp"
      : "luckinMcp 已经启用，无需修改";
  return {
    configPath: options.configPath,
    changed,
    text: `${action}：${options.configPath}`
  };
}

function upsertLuckinSource(
  externalSources: ExternalSourceConfig[] | undefined
): ExternalSourceConfig[] {
  const sources = [...(externalSources ?? [])];
  const index = sources.findIndex((source) => source.id === "luckinMcp");
  if (index === -1) {
    return [...sources, DEFAULT_LUCKIN_SOURCE];
  }
  const current = sources[index];
  const shouldMigrateLegacySource = isLegacyLuckinMcpCommand(current);
  sources[index] = {
    ...DEFAULT_LUCKIN_SOURCE,
    ...current,
    enabled: true,
    label: shouldMigrateLegacySource ? DEFAULT_LUCKIN_SOURCE.label : current.label ?? DEFAULT_LUCKIN_SOURCE.label,
    command: shouldMigrateLegacySource ? DEFAULT_LUCKIN_SOURCE.command : current.command ?? DEFAULT_LUCKIN_SOURCE.command,
    args: shouldMigrateLegacySource ? DEFAULT_LUCKIN_SOURCE.args : current.args ?? DEFAULT_LUCKIN_SOURCE.args,
    timeoutMs: shouldMigrateLegacySource ? DEFAULT_LUCKIN_SOURCE.timeoutMs : current.timeoutMs ?? DEFAULT_LUCKIN_SOURCE.timeoutMs
  };
  return sources;
}

function isLegacyLuckinMcpCommand(source: ExternalSourceConfig): boolean {
  return source.command === "node" && (source.args ?? []).some((arg) => /luckin-mcp-source-cli\.ts$/.test(arg));
}

function stripJsonBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}
