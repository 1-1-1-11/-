export type Fulfillment = "delivery" | "pickup";

export type ProviderStatusCode =
  | "login_required"
  | "captcha_required"
  | "no_stock"
  | "unavailable"
  | "ok";

export interface Discount {
  label: string;
  amount: number;
}

export interface AddressConfig {
  alias: string;
  label: string;
  query: string;
  longitude?: number;
  latitude?: number;
}

export interface BrandConfig {
  name: string;
  enabled: boolean;
}

export interface SourceConfig {
  priceBook?: boolean;
  cityBenchmark?: boolean;
  meituan: boolean;
  eleme: boolean;
  brandOfficial: boolean;
}

export interface ExternalSourceConfig {
  id: string;
  label?: string;
  enabled?: boolean;
  type?: "command" | "http" | "mcp";
  command?: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  url?: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
  headerEnv?: Record<string, string>;
  bearerTokenEnv?: string;
  bearerTokenFile?: string;
  endpoint?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  toolResultPath?: string;
}

export interface PriceBookRefreshQueryConfig {
  message: string;
  addressAlias?: string;
}

export interface PriceBookRefreshConfig {
  outputPath?: string;
  mergeExisting?: boolean;
  queries?: PriceBookRefreshQueryConfig[];
}

export interface CoffeePriceConfig {
  defaultAddressAlias: string;
  addresses: AddressConfig[];
  browserProfilePath: string;
  openLowestPurchasePage?: boolean;
  priceBookPath?: string;
  priceBookRefresh?: PriceBookRefreshConfig;
  brands: BrandConfig[];
  sources: SourceConfig;
  browserSources?: BrowserSourcesConfig;
  externalSources?: ExternalSourceConfig[];
}

export type BrowserSourcesConfig = Partial<Record<keyof SourceConfig, BrowserSourceSpec>>;

export interface CoffeeQuery {
  rawText: string;
  addressAlias: string | null;
  drink: string;
  normalizedDrink: string;
  temperature: "冰" | "热" | null;
  size: string | null;
  quantity: number;
  fulfillment: "delivery" | "pickup" | "both";
}

export interface PriceParts {
  fulfillment: Fulfillment;
  itemPrice: number;
  quantity: number;
  deliveryFee?: number;
  packagingFee?: number;
  discounts?: Discount[];
}

export interface OfferCandidate extends PriceParts {
  source: string;
  brand: string;
  storeName: string;
  drinkName: string;
  normalizedDrink: string;
  size: string | null;
  distanceText?: string;
  etaText?: string;
  purchaseUrl?: string;
  totalPrice?: number;
}

export interface PricedOffer extends OfferCandidate {
  totalPrice: number;
}

export interface ProviderStatus {
  status: Exclude<ProviderStatusCode, "ok">;
  message: string;
}

export interface PlatformSnapshot {
  source: string;
  status?: Exclude<ProviderStatusCode, "ok">;
  message?: string;
  offers?: PlatformSnapshotOffer[];
}

export interface PlatformSnapshotOffer {
  source?: string;
  brand: string;
  storeName: string;
  drinkName: string;
  normalizedDrink: string;
  size?: string | null;
  fulfillment: Fulfillment;
  itemPrice: number;
  quantity?: number;
  deliveryFee?: number;
  packagingFee?: number;
  discounts?: Discount[];
  distanceText?: string;
  etaText?: string;
  purchaseUrl?: string;
  totalPrice?: number;
  unavailableReason?: string;
}

export interface PriceBook {
  source?: string;
  updatedAt?: string;
  offers?: PriceBookOffer[];
}

export interface PriceBookOffer extends PlatformSnapshotOffer {
  addressAliases?: string[];
  addressQueries?: string[];
}

export interface BrowserSourceSpec {
  source: keyof SourceConfig | string;
  entryUrl: string;
  selectors: BrowserSourceSelectors;
  browser?: {
    channel?: "chrome" | "msedge" | "chromium";
    headless?: boolean;
    waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
    waitForSelector?: string;
    timeoutMs?: number;
    search?: {
      inputSelector: string;
      submitSelector?: string;
      waitAfterMs?: number;
    };
  };
}

export interface BrowserSourceSelectors {
  loginRequired?: string;
  captchaRequired?: string;
  noStock?: string;
  statusTextPatterns?: {
    loginRequired?: string[];
    captchaRequired?: string[];
    noStock?: string[];
    unavailable?: string[];
  };
  offerRows: string;
  fields: {
    brand: string;
    storeName: string;
    drinkName: string;
    normalizedDrink?: string;
    size?: string;
    fulfillment: string;
    itemPrice: string;
    quantity?: string;
    deliveryFee?: string;
    packagingFee?: string;
    distanceText?: string;
    etaText?: string;
    purchaseUrl?: string;
  };
  discounts?: {
    rows: string;
    label: string;
    amount: string;
  };
}

export interface CoffeeSourceProvider {
  id: string;
  label: string;
  search(input: {
    query: CoffeeQuery;
    config: CoffeePriceConfig;
    address: AddressConfig;
  }): Promise<OfferCandidate[] | ProviderStatus>;
}

export interface SearchResult {
  query: CoffeeQuery;
  resolvedAddress: AddressConfig;
  delivery: PricedOffer[];
  pickup: PricedOffer[];
  warnings: string[];
  generatedAt: Date;
}

export interface SearchCoffeePricesInput {
  query: CoffeeQuery;
  config: CoffeePriceConfig;
  providers: CoffeeSourceProvider[];
}
