import { captureBrowserSource } from "./browser-capture.js";
import type { CaptureBrowserSourceInput } from "./browser-capture.js";
import type { SourceConfig } from "./types.js";

export interface CaptureCliOptions {
  message: string;
  source: keyof SourceConfig;
  configPath: string;
  htmlPath: string;
  snapshotPath: string;
  manualWaitMs?: number;
}

const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";
const SOURCE_KEYS = ["meituan", "eleme", "brandOfficial"] as const;

export function parseCaptureCliArgs(args: string[]): CaptureCliOptions {
  const message = args.find((arg) => !arg.startsWith("--"));
  if (!message) {
    throw new Error(usage());
  }

  const source = parseSource(readOption(args, "--source") ?? "meituan");
  const defaultPaths = buildDefaultCapturePaths(source);
  const manualWaitMs = readNumberOption(args, "--manual-ms");

  return {
    message,
    source,
    configPath: readOption(args, "--config") ?? DEFAULT_CONFIG_PATH,
    htmlPath: readOption(args, "--html") ?? defaultPaths.htmlPath,
    snapshotPath: readOption(args, "--snapshot") ?? defaultPaths.snapshotPath,
    manualWaitMs
  };
}

export async function runCaptureCli(args: string[]): Promise<string> {
  const options = parseCaptureCliArgs(args);
  const result = await captureBrowserSource(toCaptureInput(options));
  const offerCount = result.snapshot.offers?.length ?? 0;
  return [
    `已捕获 ${options.source} 页面`,
    `页面: ${result.url}`,
    `HTML: ${result.htmlPath}`,
    `Snapshot: ${result.snapshotPath}`,
    `候选数: ${offerCount}`,
    result.snapshot.status ? `状态: ${result.snapshot.status} ${result.snapshot.message ?? ""}` : null
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function toCaptureInput(options: CaptureCliOptions): CaptureBrowserSourceInput {
  return {
    configPath: options.configPath,
    source: options.source,
    message: options.message,
    htmlPath: options.htmlPath,
    snapshotPath: options.snapshotPath,
    manualWaitMs: options.manualWaitMs
  };
}

function buildDefaultCapturePaths(source: keyof SourceConfig): {
  htmlPath: string;
  snapshotPath: string;
} {
  return {
    htmlPath: `.runtime/captures/${source}.html`,
    snapshotPath: `.runtime/captures/${source}.snapshot.json`
  };
}

function parseSource(value: string): keyof SourceConfig {
  if ((SOURCE_KEYS as readonly string[]).includes(value)) {
    return value as keyof SourceConfig;
  }
  throw new Error(`不支持的渠道: ${value}`);
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
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
    'Usage: npm run capture -- "查公司附近冰美式" --source meituan',
    "Options:",
    "  --config <path>      默认 config/coffee-price.config.json",
    "  --source <source>    meituan | eleme | brandOfficial",
    "  --html <path>        默认 .runtime/captures/<source>.html",
    "  --snapshot <path>    默认 .runtime/captures/<source>.snapshot.json",
    "  --manual-ms <ms>     打开页面后等待人工登录/处理验证码的毫秒数"
  ].join("\n");
}
