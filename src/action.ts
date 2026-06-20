import { readConfig } from "./config.js";
import { formatWechatReply } from "./formatter.js";
import { parseCoffeeCommand } from "./query-parser.js";
import {
  openLowestPurchasePage,
  type PurchasePageOpenResult,
  type PurchasePageOpener
} from "./purchase-page-opener.js";
import { searchCoffeePrices } from "./search-service.js";
import { BrowserSourceProvider } from "./providers/browser-source-provider.js";
import { SnapshotFileProvider } from "./providers/platform-snapshot-provider.js";
import type { BrowserSourcesConfig, CoffeeSourceProvider, SourceConfig } from "./types.js";

export interface RunCoffeePriceSearchInput {
  message: string;
  configPath?: string;
  snapshotPaths?: Partial<Record<keyof SourceConfig, string>>;
  purchasePageOpener?: PurchasePageOpener;
}

const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";

const SOURCE_LABELS: Record<keyof SourceConfig, string> = {
  meituan: "美团",
  eleme: "饿了么",
  brandOfficial: "品牌官方"
};

export async function runCoffeePriceSearch(input: RunCoffeePriceSearchInput): Promise<string> {
  const config = await readConfig(input.configPath ?? process.env.COFFEE_PRICE_CONFIG ?? DEFAULT_CONFIG_PATH);
  const query = parseCoffeeCommand(input.message);
  const providers = createProviders(config.sources, input.snapshotPaths ?? {}, config.browserSources);
  const result = await searchCoffeePrices({ query, config, providers });
  const openResult = config.openLowestPurchasePage
    ? await openLowestPurchasePage(result, input.purchasePageOpener)
    : null;
  return appendPurchaseOpenResult(formatWechatReply(result), openResult);
}

function createProviders(
  sources: SourceConfig,
  snapshotPaths: Partial<Record<keyof SourceConfig, string>>,
  browserSources: BrowserSourcesConfig = {}
): CoffeeSourceProvider[] {
  return (Object.keys(sources) as (keyof SourceConfig)[])
    .filter((source) => sources[source])
    .map((source) => {
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
