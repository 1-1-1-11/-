import { calculateOfferTotal } from "./pricing.js";
import type {
  AddressConfig,
  CoffeeSourceProvider,
  OfferCandidate,
  PricedOffer,
  ProviderStatus,
  SearchCoffeePricesInput,
  SearchResult
} from "./types.js";

export async function searchCoffeePrices(input: SearchCoffeePricesInput): Promise<SearchResult> {
  const address = resolveAddress(input);
  const enabledBrands = new Set(
    input.config.brands.filter((brand) => brand.enabled).map((brand) => brand.name)
  );
  const warnings: string[] = [];
  const offers: PricedOffer[] = [];

  for (const provider of input.providers) {
    const providerResult = await provider.search({
      query: input.query,
      config: input.config,
      address
    });

    if (isProviderStatus(providerResult)) {
      warnings.push(providerResult.message);
      continue;
    }

    for (const offer of providerResult) {
      if (!enabledBrands.has(offer.brand)) {
        continue;
      }
      if (!matchesCoffeeQuery(offer, input.query.normalizedDrink, input.query.size)) {
        continue;
      }
      const pricedOffer = withQueryQuantity(offer, input.query.quantity);
      offers.push({
        ...pricedOffer,
        totalPrice: totalForQueryQuantity(offer, pricedOffer)
      });
    }
  }

  return {
    query: input.query,
    resolvedAddress: address,
    delivery: topThree(offers, "delivery"),
    pickup: topThree(offers, "pickup"),
    warnings,
    generatedAt: new Date()
  };
}

function resolveAddress(input: SearchCoffeePricesInput): AddressConfig {
  const alias = input.query.addressAlias ?? input.config.defaultAddressAlias;
  const address = input.config.addresses.find((candidate) => candidate.alias === alias);
  if (address) {
    return address;
  }
  if (input.config.addresses[0]) {
    return input.config.addresses[0];
  }
  throw new Error("没有配置常用地址，无法查询附近咖啡");
}

function isProviderStatus(value: OfferCandidate[] | ProviderStatus): value is ProviderStatus {
  return !Array.isArray(value);
}

function matchesCoffeeQuery(offer: OfferCandidate, normalizedDrink: string, size: string | null): boolean {
  if (offer.normalizedDrink !== normalizedDrink) {
    return false;
  }
  return !size || offer.size === size;
}

function withQueryQuantity(offer: OfferCandidate, quantity: number): OfferCandidate {
  return {
    ...offer,
    quantity
  };
}

function totalForQueryQuantity(original: OfferCandidate, adjusted: OfferCandidate): number {
  if (original.totalPrice !== undefined && original.quantity === adjusted.quantity) {
    return original.totalPrice;
  }
  return calculateOfferTotal(adjusted);
}

function topThree(offers: PricedOffer[], fulfillment: "delivery" | "pickup"): PricedOffer[] {
  return offers
    .filter((offer) => offer.fulfillment === fulfillment)
    .sort((left, right) => left.totalPrice - right.totalPrice)
    .slice(0, 3);
}

export type { CoffeeSourceProvider };
