import { fileURLToPath } from "node:url";

import { captureBrowserSource } from "./browser-capture.js";
import type { CaptureBrowserSourceInput, CaptureBrowserSourceResult } from "./browser-capture.js";
import { readConfig } from "./config.js";
import type { CoffeePriceConfig, SourceConfig } from "./types.js";

export interface CaptureCalibrateCliOptions {
  message: string;
  configPath: string;
  manualWaitMs?: number;
  urls: Partial<Record<keyof SourceConfig, string>>;
}

export interface CaptureCalibrationTask {
  source: keyof SourceConfig;
  input: CaptureBrowserSourceInput;
}

export interface CaptureCalibrateDeps {
  readConfig?: (configPath: string) => Promise<CoffeePriceConfig>;
  capture?: (input: CaptureBrowserSourceInput) => Promise<CaptureBrowserSourceResult>;
}

const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";
const SOURCE_KEYS = ["meituan", "eleme", "brandOfficial"] as const;

export function parseCaptureCalibrateCliArgs(args: string[]): CaptureCalibrateCliOptions {
  const message = args.find((arg) => !arg.startsWith("--"));
  if (!message) {
    throw new Error(usage());
  }

  return {
    message,
    configPath: readOption(args, "--config") ?? DEFAULT_CONFIG_PATH,
    manualWaitMs: readNumberOption(args, "--manual-ms"),
    urls: {
      meituan: readUrlOption(args, "--url-meituan"),
      eleme: readUrlOption(args, "--url-eleme"),
      brandOfficial: readUrlOption(args, "--url-brand") ?? readUrlOption(args, "--url-brandOfficial")
    }
  };
}

export function buildCaptureCalibrationTasks(
  config: CoffeePriceConfig,
  options: CaptureCalibrateCliOptions
): CaptureCalibrationTask[] {
  const tasks: CaptureCalibrationTask[] = [];

  for (const source of SOURCE_KEYS) {
    if (!config.sources[source]) {
      continue;
    }
    const spec = config.browserSources?.[source];
    if (!spec) {
      throw new Error(`${source} 已启用但缺少 browserSources；先运行 npm run config:scaffold -- --write`);
    }

    const urlOverride = options.urls[source];
    if (isPlaceholderUrl(spec.entryUrl) && !urlOverride) {
      throw new Error(`${source} 仍是 example.com 占位入口；请传 ${urlFlag(source)} <real-platform-url>`);
    }

    tasks.push({
      source,
      input: {
        configPath: options.configPath,
        source,
        message: options.message,
        htmlPath: `.runtime/captures/${source}.html`,
        snapshotPath: `.runtime/captures/${source}.snapshot.json`,
        auditPath: `.runtime/captures/${source}.audit.json`,
        entryUrlOverride: urlOverride,
        saveEntryUrl: Boolean(urlOverride),
        manualWaitMs: options.manualWaitMs
      }
    });
  }

  if (tasks.length === 0) {
    throw new Error("没有启用任何渠道，无法批量校准");
  }

  return tasks;
}

export async function runCaptureCalibrateCli(
  args: string[],
  deps: CaptureCalibrateDeps = {}
): Promise<string> {
  const options = parseCaptureCalibrateCliArgs(args);
  const config = await (deps.readConfig ?? readConfig)(options.configPath);
  const tasks = buildCaptureCalibrationTasks(config, options);
  const capture = deps.capture ?? captureBrowserSource;
  const lines = [`开始批量校准 ${tasks.length} 个渠道`];

  for (const task of tasks) {
    const result = await capture(task.input);
    const saved = task.input.saveEntryUrl ? "，入口 URL 已写回配置" : "";
    lines.push(
      `[${task.source}] ${result.url}${saved}`,
      `  HTML: ${result.htmlPath}`,
      `  Snapshot: ${result.snapshotPath}`,
      `  Selector audit: ${result.auditPath}`
    );
  }

  lines.push("完成后运行 npm run verify:live 查看剩余现场验收项");
  return lines.join("\n");
}

function isPlaceholderUrl(entryUrl: string): boolean {
  return /^https?:\/\/example\.com(?:[/:?#]|$)/i.test(entryUrl);
}

function urlFlag(source: keyof SourceConfig): string {
  return source === "brandOfficial" ? "--url-brand" : `--url-${source}`;
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function readUrlOption(args: string[], name: string): string | undefined {
  const value = readOption(args, name);
  if (!value) {
    return undefined;
  }
  return validateHttpUrl(value);
}

function validateHttpUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${trimmed} 不是有效的 http/https URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${trimmed} 不是有效的 http/https URL`);
  }
  return trimmed;
}

function readNumberOption(args: string[], name: string): number | undefined {
  const value = readOption(args, name);
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} 必须是非负整数毫秒`);
  }
  return parsed;
}

function usage(): string {
  return [
    'Usage: npm run capture:calibrate -- "查公司附近冰美式"',
    "Options:",
    "  --config <path>        默认 config/coffee-price.config.json",
    "  --manual-ms <ms>       每个渠道打开页面后等待人工登录/处理验证码的毫秒数",
    "  --url-meituan <url>    美团真实搜索或店铺入口 URL",
    "  --url-eleme <url>      饿了么真实搜索或店铺入口 URL",
    "  --url-brand <url>      品牌官方真实入口 URL"
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(await runCaptureCalibrateCli(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
