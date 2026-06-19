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
  brands: BrandConfig[];
  sources: SourceConfig;
}

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
