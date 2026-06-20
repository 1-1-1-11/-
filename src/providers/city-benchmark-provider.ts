import type {
  AddressConfig,
  CoffeePriceConfig,
  CoffeeQuery,
  CoffeeSourceProvider,
  OfferCandidate
} from "../types.js";

type BenchmarkBrand = "星巴克" | "瑞幸" | "库迪";
type BenchmarkDrink = "americano" | "latte" | "cappuccino" | "mocha";
type CityTier = "tier1" | "tier2" | "tier3";

const BASE_PRICES: Record<BenchmarkBrand, Record<BenchmarkDrink, number>> = {
  星巴克: {
    americano: 32,
    latte: 38,
    cappuccino: 36,
    mocha: 39
  },
  瑞幸: {
    americano: 20,
    latte: 24,
    cappuccino: 23,
    mocha: 25
  },
  库迪: {
    americano: 18,
    latte: 22,
    cappuccino: 21,
    mocha: 23
  }
};

const CITY_TIERS: Record<CityTier, string[]> = {
  tier1: ["北京", "上海", "深圳", "广州", "杭州"],
  tier2: [
    "成都",
    "重庆",
    "武汉",
    "南京",
    "苏州",
    "天津",
    "西安",
    "长沙",
    "厦门",
    "青岛",
    "宁波",
    "郑州",
    "合肥",
    "佛山",
    "东莞"
  ],
  tier3: []
};

const TIER_MULTIPLIER: Record<CityTier, number> = {
  tier1: 1,
  tier2: 0.92,
  tier3: 0.85
};

export class CityBenchmarkProvider implements CoffeeSourceProvider {
  constructor(
    public readonly id = "cityBenchmark",
    public readonly label = "城市参考价"
  ) {}

  async search(input: {
    query: CoffeeQuery;
    config: CoffeePriceConfig;
    address: AddressConfig;
  }): Promise<OfferCandidate[]> {
    const drink = toBenchmarkDrink(input.query.normalizedDrink);
    if (!drink) {
      return [];
    }
    const city = inferCity(input.address.query) ?? input.address.label;
    const tier = inferTier(city);
    const multiplier = TIER_MULTIPLIER[tier];

    return (Object.keys(BASE_PRICES) as BenchmarkBrand[]).map((brand) => {
      const price = round(BASE_PRICES[brand][drink] * multiplier);
      return {
        source: this.id,
        brand,
        storeName: `${city}参考价（非实时）`,
        drinkName: input.query.drink,
        normalizedDrink: input.query.normalizedDrink,
        size: input.query.size ?? "标准杯",
        fulfillment: "pickup",
        itemPrice: price,
        quantity: 1,
        distanceText: `${city}/${tierLabel(tier)}`,
        etaText: "仅作横向参考",
        purchaseUrl: "https://clawhub.ai/realank/coffee-prices"
      };
    });
  }
}

function toBenchmarkDrink(normalizedDrink: string): BenchmarkDrink | null {
  if (
    normalizedDrink === "americano" ||
    normalizedDrink === "latte" ||
    normalizedDrink === "cappuccino" ||
    normalizedDrink === "mocha"
  ) {
    return normalizedDrink;
  }
  return null;
}

function inferCity(addressQuery: string): string | null {
  const normalized = addressQuery.replace(/\s+/g, "");
  const match = normalized.match(/([\p{Script=Han}]{2,4})(?:市|省|自治区|特别行政区|区|县)/u);
  if (match?.[1]) {
    return normalizeCityName(match[1]);
  }
  for (const city of [...CITY_TIERS.tier1, ...CITY_TIERS.tier2]) {
    if (normalized.includes(city)) {
      return city;
    }
  }
  return null;
}

function normalizeCityName(value: string): string {
  for (const city of [...CITY_TIERS.tier1, ...CITY_TIERS.tier2]) {
    if (value.includes(city)) {
      return city;
    }
  }
  return value;
}

function inferTier(city: string): CityTier {
  if (CITY_TIERS.tier1.includes(city)) {
    return "tier1";
  }
  if (CITY_TIERS.tier2.includes(city)) {
    return "tier2";
  }
  return "tier3";
}

function tierLabel(tier: CityTier): string {
  switch (tier) {
    case "tier1":
      return "一线参考";
    case "tier2":
      return "二线参考";
    case "tier3":
      return "三线参考";
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
