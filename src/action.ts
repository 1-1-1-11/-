import { readConfig } from "./config.js";
import { formatWechatReply } from "./formatter.js";
import { parseCoffeeCommand } from "./query-parser.js";
import {
  openLowestPurchasePage,
  type PurchasePageOpenResult,
  type PurchasePageOpener
} from "./purchase-page-opener.js";
import { searchCoffeePrices } from "./search-service.js";
import { ExternalCommandProvider } from "./providers/external-command-provider.js";
import { BrowserSourceProvider } from "./providers/browser-source-provider.js";
import { SnapshotFileProvider } from "./providers/platform-snapshot-provider.js";
import { PriceBookProvider } from "./providers/price-book-provider.js";
import { CityBenchmarkProvider } from "./providers/city-benchmark-provider.js";
import type { BrowserSourcesConfig, CoffeePriceConfig, CoffeeSourceProvider, SourceConfig } from "./types.js";

export interface RunCoffeePriceSearchInput {
  message: string;
  configPath?: string;
  snapshotPaths?: Partial<Record<keyof SourceConfig, string>>;
  purchasePageOpener?: PurchasePageOpener;
}

const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";

const SOURCE_LABELS: Record<keyof SourceConfig, string> = {
  priceBook: "本地价格库",
  cityBenchmark: "城市参考价",
  meituan: "美团",
  eleme: "饿了么",
  brandOfficial: "品牌官方"
};

export async function runCoffeePriceSearch(input: RunCoffeePriceSearchInput): Promise<string> {
  const config = await readConfig(input.configPath ?? process.env.COFFEE_PRICE_CONFIG ?? DEFAULT_CONFIG_PATH);
  const query = parseCoffeeCommand(input.message);
  const providers = createProviders(config, input.snapshotPaths ?? {});
  const result = await searchCoffeePrices({ query, config, providers });
  const openResult = config.openLowestPurchasePage
    ? await openLowestPurchasePage(result, input.purchasePageOpener)
    : null;
  return appendPurchaseOpenResult(formatWechatReply(result), openResult);
}

function createProviders(
  config: CoffeePriceConfig,
  snapshotPaths: Partial<Record<keyof SourceConfig, string>>
): CoffeeSourceProvider[] {
  const browserSources: BrowserSourcesConfig = config.browserSources ?? {};
  const providers: CoffeeSourceProvider[] = (Object.keys(config.sources) as (keyof SourceConfig)[])
    .filter((source) => config.sources[source])
    .map((source) => {
      if (source === "priceBook") {
        return config.priceBookPath
          ? new PriceBookProvider(source, SOURCE_LABELS[source], config.priceBookPath)
          : new NotConfiguredProvider(source, SOURCE_LABELS[source]);
      }
      if (source === "cityBenchmark") {
        return new CityBenchmarkProvider(source, SOURCE_LABELS[source]);
      }
      const snapshotPath = snapshotPaths[source];
      if (snapshotPath) {
        return new SnapshotFileProvider(source, SOURCE_LABELS[source], snapshotPath);
      }
      const browserProvider = createBrowserProvider(source, browserSources);
      if (browserProvider) {
        return browserProvider;
      }
      return new NotConfiguredProvider(source, SOURCE_LABELS[source]);
    });
  for (const source of config.externalSources ?? []) {
    providers.push(new ExternalCommandProvider(source));
  }
  return providers;
}

function createBrowserProvider(
  source: keyof SourceConfig,
  browserSources: BrowserSourcesConfig
): BrowserSourceProvider | null {
  const spec = browserSources[source];
  return spec ? new BrowserSourceProvider(source, SOURCE_LABELS[source], spec) : null;
}

class NotConfiguredProvider implements CoffeeSourceProvider {
  constructor(
    public readonly id: string,
    public readonly label: string
  ) {}

  async search() {
    return {
      status: "unavailable" as const,
      message: `${this.label} 适配器还没有配置登录态或快照路径。`
    };
  }
}

function appendPurchaseOpenResult(reply: string, result: PurchasePageOpenResult | null): string {
  if (!result) {
    return reply;
  }
  if (result.status === "opened") {
    const offer = result.selection.offer;
    return [
      reply,
      "",
      `已打开最低价购买页: ${offer.brand} ${offer.storeName} ¥${offer.totalPrice.toFixed(2)}`,
      result.selection.url
    ].join("\n");
  }
  return [reply, "", `未打开购买页: ${result.message}`].join("\n");
}
