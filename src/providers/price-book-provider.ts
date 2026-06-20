import { readFile } from "node:fs/promises";

import { parsePlatformSnapshot } from "./platform-snapshot-provider.js";
import type {
  AddressConfig,
  CoffeePriceConfig,
  CoffeeQuery,
  CoffeeSourceProvider,
  OfferCandidate,
  PriceBook,
  PriceBookOffer,
  ProviderStatus
} from "../types.js";

export class PriceBookProvider implements CoffeeSourceProvider {
  constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly priceBookPath: string
  ) {}

  async search(input: {
    query: CoffeeQuery;
    config: CoffeePriceConfig;
    address: AddressConfig;
  }): Promise<OfferCandidate[] | ProviderStatus> {
    try {
      const priceBook = JSON.parse(await readFile(this.priceBookPath, "utf8")) as PriceBook;
      const source = priceBook.source ?? this.id;
      const offers = (priceBook.offers ?? []).filter((offer) => matchesAddress(offer, input.address));
      return parsePlatformSnapshot({ source, offers });
    } catch (error) {
      return {
        status: "unavailable",
        message: `${this.label}不可用：${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

function matchesAddress(offer: PriceBookOffer, address: AddressConfig): boolean {
  if (offer.addressAliases?.length && !offer.addressAliases.includes(address.alias)) {
    return false;
  }
  if (offer.addressQueries?.length) {
    const query = address.query.toLowerCase();
    return offer.addressQueries.some((candidate) => {
      const normalized = candidate.toLowerCase();
      return query.includes(normalized) || normalized.includes(query);
    });
  }
  return true;
}
