const REFERENCE_PRICE_SOURCES = new Set(["priceBook", "cityBenchmark"]);

export function isReferencePriceSource(source: string): boolean {
  return REFERENCE_PRICE_SOURCES.has(source);
}
