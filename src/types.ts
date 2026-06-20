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
}

export interface BrandConfig {
  name: string;
  enabled: boolean;
}

export interface SourceConfig {
  meituan: boolean;
  eleme: boolean;
  brandOfficial: boolean;
}

export interface CoffeePriceConfig {
  defaultAddressAlias: string;
  addresses: AddressConfig[];
  browserProfilePath: string;
  openLowestPurchasePage?: boolean;
  brands: BrandConfig[];
  sources: SourceConfig;
  browserSources?: BrowserSourcesConfig;
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
  unavailableReason?: string;
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
