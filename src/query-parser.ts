import type { CoffeeQuery } from "./types.js";

const DRINK_ALIASES = [
  { pattern: /冰美式|冷美式|美式/, drink: "冰美式", normalized: "americano" },
  { pattern: /热美式/, drink: "热美式", normalized: "americano" },
  { pattern: /拿铁|latte/i, drink: "拿铁", normalized: "latte" },
  { pattern: /澳白|馥芮白|flat\s*white/i, drink: "澳白", normalized: "flat_white" },
  { pattern: /卡布|卡布奇诺|cappuccino/i, drink: "卡布奇诺", normalized: "cappuccino" },
  { pattern: /摩卡|mocha/i, drink: "摩卡", normalized: "mocha" }
] as const;

const QUANTITY_WORDS = new Map<string, number>([
  ["一", 1],
  ["两", 2],
  ["二", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
  ["十", 10]
]);

export function parseCoffeeCommand(rawText: string): CoffeeQuery {
  const text = rawText.trim();
  if (!isCoffeePriceCommand(text)) {
    throw new Error("不是咖啡查价指令");
  }

  const drinkMatch = DRINK_ALIASES.find((entry) => entry.pattern.test(text));
  if (!drinkMatch) {
    throw new Error("没有识别到要查询的咖啡品类");
  }

  return {
    rawText: text,
    addressAlias: parseAddressAlias(text),
    drink: drinkMatch.drink,
    normalizedDrink: drinkMatch.normalized,
    temperature: parseTemperature(text),
    size: parseSize(text),
    quantity: parseQuantity(text),
    fulfillment: "both"
  };
}

function isCoffeePriceCommand(text: string): boolean {
  const hasLookupVerb = /查|搜|找|比价/.test(text);
  const hasCoffeeIntent = /咖啡|美式|拿铁|澳白|馥芮白|卡布|摩卡|瑞幸|库迪|星巴克|Tims/i.test(text);
  return hasLookupVerb && hasCoffeeIntent;
}

function parseAddressAlias(text: string): string | null {
  const match = text.match(/([\p{Script=Han}A-Za-z0-9_-]{1,12})附近/u);
  if (!match?.[1]) {
    return null;
  }
  const alias = match[1].replace(/^(查|搜|找|比价)/, "").replace(/咖啡$/, "");
  return alias || null;
}

function parseTemperature(text: string): "冰" | "热" | null {
  if (/冰|冷/.test(text)) {
    return "冰";
  }
  if (/热|暖/.test(text)) {
    return "热";
  }
  return null;
}

function parseSize(text: string): string | null {
  return text.match(/超大杯|大杯|中杯|小杯/)?.[0] ?? null;
}

function parseQuantity(text: string): number {
  const numeric = text.match(/(\d+)\s*杯/);
  if (numeric?.[1]) {
    return Math.max(1, Number.parseInt(numeric[1], 10));
  }
  const word = text.match(/([一二两三四五六七八九十])\s*杯/u)?.[1];
  return word ? QUANTITY_WORDS.get(word) ?? 1 : 1;
}
