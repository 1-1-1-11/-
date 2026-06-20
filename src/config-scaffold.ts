import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { normalizeConfig } from "./config.js";
import type { BrowserSourceSpec, CoffeePriceConfig, SourceConfig } from "./types.js";

export interface ConfigScaffoldCliOptions {
  configPath: string;
  write: boolean;
}

export interface ConfigScaffoldResult {
  config: CoffeePriceConfig;
  addedSources: (keyof SourceConfig)[];
}

const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";
const SOURCE_KEYS = ["meituan", "eleme", "brandOfficial"] as const;

export function scaffoldBrowserSources(config: CoffeePriceConfig): ConfigScaffoldResult {
  const browserSources = { ...(config.browserSources ?? {}) };
  const addedSources: (keyof SourceConfig)[] = [];

  for (const source of SOURCE_KEYS) {
    if (!config.sources[source] || browserSources[source]) {
      continue;
    }
    browserSources[source] = createBrowserSourceTemplate(source);
    addedSources.push(source);
  }

  return {
    config: {
      ...config,
      browserSources
    },
    addedSources
  };
}

export function parseConfigScaffoldCliArgs(args: string[]): ConfigScaffoldCliOptions {
  return {
    configPath: readOption(args, "--config") ?? DEFAULT_CONFIG_PATH,
    write: args.includes("--write")
  };
}

export async function runConfigScaffoldCli(args: string[]): Promise<string> {
  const options = parseConfigScaffoldCliArgs(args);
  const raw = JSON.parse(stripJsonBom(await readFile(options.configPath, "utf8"))) as Partial<CoffeePriceConfig>;
  const result = scaffoldBrowserSources(normalizeConfig(raw));
  const json = `${JSON.stringify(result.config, null, 2)}\n`;

  if (options.write) {
    await writeFile(options.configPath, json, "utf8");
    return `已更新 ${options.configPath}；新增 browserSources: ${formatAdded(result.addedSources)}`;
  }

  return [
    `新增 browserSources: ${formatAdded(result.addedSources)}`,
    "预览如下；确认后加 --write 写入配置文件：",
    json.trimEnd()
  ].join("\n");
}

function createBrowserSourceTemplate(source: keyof SourceConfig): BrowserSourceSpec {
  return {
    source,
    entryUrl: `https://example.com/${source}/search?address={{addressQuery}}&drink={{drink}}&quantity={{quantity}}`,
    selectors: {
      loginRequired: "[data-login-required]",
      captchaRequired: "[data-captcha-required]",
      noStock: "[data-no-stock]",
      statusTextPatterns: {
        loginRequired: ["登录", "请登录", "未登录", "授权登录"],
        captchaRequired: ["验证码", "安全验证", "滑块验证", "verify"],
        noStock: ["无货", "售罄", "已售完", "附近门店无货"],
        unavailable: ["网络好像不太给力", "请稍后再试", "网络错误", "重新加载"]
      },
      offerRows: "[data-offer]",
      fields: {
        brand: "[data-brand]",
        storeName: "[data-store]",
        drinkName: "[data-drink]",
        normalizedDrink: "[data-normalized-drink]",
        size: "[data-size]",
        fulfillment: "[data-fulfillment]",
        itemPrice: "[data-item-price]",
        quantity: "[data-quantity]",
        deliveryFee: "[data-delivery-fee]",
        packagingFee: "[data-packaging-fee]",
        distanceText: "[data-distance]",
        etaText: "[data-eta]",
        purchaseUrl: "[data-purchase-url]"
      },
      discounts: {
        rows: "[data-discount]",
        label: "[data-discount-label]",
        amount: "[data-discount-amount]"
      }
    },
    browser: {
      channel: "msedge",
      headless: false,
      waitUntil: "domcontentloaded",
      waitForSelector: "[data-offer]",
      timeoutMs: 60_000
    }
  };
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

function formatAdded(sources: (keyof SourceConfig)[]): string {
  return sources.length > 0 ? sources.join(", ") : "无";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(await runConfigScaffoldCli(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
