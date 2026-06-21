import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface OpenClawDeepSeekCompatOptions {
  configPath?: string;
  dryRun?: boolean;
}

export interface OpenClawDeepSeekCompatResult {
  configPath: string;
  changed: boolean;
  before: OpenClawDeepSeekCompatSnapshot;
  after: OpenClawDeepSeekCompatSnapshot;
}

export interface OpenClawDeepSeekCompatSnapshot {
  allow: string[];
  memoryCoreEnabled: boolean | null;
  enabledEntries: string[];
}

interface OpenClawConfig {
  plugins?: {
    allow?: string[];
    entries?: Record<string, { enabled?: boolean; config?: unknown }>;
  };
}

const REQUIRED_ALLOW = ["coffee-price", "openclaw-weixin", "deepseek"];

export async function applyOpenClawDeepSeekCompat(
  options: OpenClawDeepSeekCompatOptions = {}
): Promise<OpenClawDeepSeekCompatResult> {
  const configPath = options.configPath ?? defaultOpenClawConfigPath();
  const originalText = await readFile(configPath, "utf8");
  const config = JSON.parse(stripJsonBom(originalText)) as OpenClawConfig;
  const before = snapshot(config);

  config.plugins ??= {};
  config.plugins.entries ??= {};
  config.plugins.allow = [...REQUIRED_ALLOW];
  config.plugins.entries["coffee-price"] = {
    ...(config.plugins.entries["coffee-price"] ?? {}),
    enabled: true
  };
  config.plugins.entries["openclaw-weixin"] = {
    ...(config.plugins.entries["openclaw-weixin"] ?? {}),
    enabled: true
  };
  config.plugins.entries.deepseek = {
    ...(config.plugins.entries.deepseek ?? {}),
    enabled: true
  };
  config.plugins.entries["memory-core"] = {
    ...(config.plugins.entries["memory-core"] ?? {}),
    enabled: false
  };

  const after = snapshot(config);
  const nextText = `${JSON.stringify(config, null, 2)}\n`;
  const changed = normalizeJsonText(originalText) !== normalizeJsonText(nextText);
  if (changed && !options.dryRun) {
    await writeFile(configPath, nextText, "utf8");
  }

  return {
    configPath,
    changed,
    before,
    after
  };
}

export function defaultOpenClawConfigPath(): string {
  return join(homedir(), ".openclaw", "openclaw.json");
}

export function formatOpenClawDeepSeekCompatResult(result: OpenClawDeepSeekCompatResult): string {
  const lines = ["OpenClaw DeepSeek tool compatibility"];
  lines.push(`- config: ${result.configPath}`);
  lines.push(`- changed: ${result.changed ? "yes" : "no"}`);
  lines.push(`- allow: ${result.after.allow.join(", ") || "(empty)"}`);
  lines.push(`- memory-core: ${result.after.memoryCoreEnabled === false ? "disabled" : "enabled/unknown"}`);
  lines.push("- next: run `npx openclaw gateway restart` if changed=yes");
  return lines.join("\n");
}

function snapshot(config: OpenClawConfig): OpenClawDeepSeekCompatSnapshot {
  const entries = config.plugins?.entries ?? {};
  return {
    allow: [...(config.plugins?.allow ?? [])],
    memoryCoreEnabled: entries["memory-core"]?.enabled ?? null,
    enabledEntries: Object.entries(entries)
      .filter(([, entry]) => entry?.enabled === true)
      .map(([id]) => id)
      .sort()
  };
}

function normalizeJsonText(value: string): string {
  try {
    return JSON.stringify(JSON.parse(stripJsonBom(value)));
  } catch {
    return value.trim();
  }
}

function stripJsonBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}
