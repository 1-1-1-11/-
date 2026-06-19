import { readFile } from "node:fs/promises";

import type {
  CoffeePriceConfig,
  CoffeeQuery,
  CoffeeSourceProvider,
  OfferCandidate,
  ProviderStatus,
  ProviderStatusCode
} from "../types.js";

interface PlatformSnapshot {
  source: string;
  status?: Exclude<ProviderStatusCode, "ok">;
  message?: string;
  offers?: PlatformSnapshotOffer[];
}

interface PlatformSnapshotOffer {
  brand: string;
  storeName: string;
  drinkName: string;
  normalizedDrink: string;
  size?: string | null;
  fulfillment: "delivery" | "pickup";
  itemPrice: number;
  quantity?: number;
  deliveryFee?: number;
  packagingFee?: number;
  discounts?: { label: string; amount: number }[];
  distanceText?: string;
  etaText?: string;
  purchaseUrl?: string;
  unavailableReason?: string;
}

export function parsePlatformSnapshot(snapshot: PlatformSnapshot): OfferCandidate[] | ProviderStatus {
  if (snapshot.status) {
    return {
      status: snapshot.status,
      message: snapshot.message ?? defaultStatusMessage(snapshot.status, snapshot.source)
    };
  }

  return (snapshot.offers ?? [])
    .filter((offer) => !offer.unavailableReason)
    .map((offer) => ({
      source: snapshot.source,
      brand: offer.brand,
      storeName: offer.storeName,
      drinkName: offer.drinkName,
      normalizedDrink: offer.normalizedDrink,
      size: offer.size ?? null,
      fulfillment: offer.fulfillment,
      itemPrice: offer.itemPrice,
      quantity: offer.quantity ?? 1,
      deliveryFee: offer.deliveryFee,
      packagingFee: offer.packagingFee,
      discounts: offer.discounts ?? [],
      distanceText: offer.distanceText,
      etaText: offer.etaText,
      purchaseUrl: offer.purchaseUrl
    }));
}

export class SnapshotFileProvider implements CoffeeSourceProvider {
  constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly snapshotPath: string
  ) {}

  async search(_input: {
    query: CoffeeQuery;
    config: CoffeePriceConfig;
  }): Promise<OfferCandidate[] | ProviderStatus> {
    const snapshot = JSON.parse(await readFile(this.snapshotPath, "utf8")) as PlatformSnapshot;
    return parsePlatformSnapshot(snapshot);
  }
}

function defaultStatusMessage(status: Exclude<ProviderStatusCode, "ok">, source: string): string {
  switch (status) {
    case "login_required":
      return `${source} 登录态失效，需要重新登录。`;
    case "captcha_required":
      return `${source} 出现验证码，需要人工处理。`;
    case "no_stock":
      return `${source} 附近门店无货。`;
    case "unavailable":
      return `${source} 当前不可用。`;
  }
}
