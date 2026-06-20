import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import { applyBrowserSearchAction } from "../browser-search-action.js";
import { waitForOptionalSelector } from "../browser-wait.js";
import { parsePlatformSnapshot } from "./platform-snapshot-provider.js";
import type {
  AddressConfig,
  BrowserSourceSpec,
  BrowserSourceSelectors,
  CoffeePriceConfig,
  CoffeeQuery,
  CoffeeSourceProvider,
  Fulfillment,
  OfferCandidate,
  PlatformSnapshot,
  PlatformSnapshotOffer,
  ProviderStatus
} from "../types.js";

export interface BrowserSourceSelectorAudit {
  source: string;
  statusMatches: {
    loginRequired: number;
    captchaRequired: number;
    noStock: number;
    unavailable: number;
  };
  offerRows: {
    selector: string;
    count: number;
  };
  rows: BrowserSourceSelectorAuditRow[];
}

export interface BrowserSourceSelectorAuditRow {
  index: number;
  fieldMatches: Record<string, number>;
  missingRequiredFields: string[];
}

export function extractPlatformSnapshotFromHtml(
  html: string,
  spec: BrowserSourceSpec,
  baseUrl?: string
): PlatformSnapshot {
  const $ = cheerio.load(html);
  const status = detectStatus($, spec);
  if (status) {
    return status;
  }

  const offers: PlatformSnapshotOffer[] = [];
  $(spec.selectors.offerRows).each((_index, element) => {
    const row = $(element);
    const offer = extractOffer($, row, spec, baseUrl);
    if (offer) {
      offers.push(offer);
    }
  });

  return { source: spec.source, offers };
}

export function auditBrowserSourceHtml(
  html: string,
  spec: BrowserSourceSpec
): BrowserSourceSelectorAudit {
  const $ = cheerio.load(html);
  const rows = $(spec.selectors.offerRows)
    .map((index, element) => auditOfferRow($, $(element), spec.selectors, index))
    .get();

  return {
    source: spec.source,
    statusMatches: {
      loginRequired: countStatusMatch($, spec, "loginRequired"),
      captchaRequired: countStatusMatch($, spec, "captchaRequired"),
      noStock: countStatusMatch($, spec, "noStock"),
      unavailable: countStatusMatch($, spec, "unavailable")
    },
    offerRows: {
      selector: spec.selectors.offerRows,
      count: rows.length
    },
    rows
  };
}

export function buildEntryUrl(
  spec: BrowserSourceSpec,
  input: { address: AddressConfig; query: CoffeeQuery }
): string {
  const values: Record<string, string | number> = {
    addressAlias: input.address.alias,
    addressLabel: input.address.label,
    addressQuery: input.address.query,
    drink: input.query.drink,
    normalizedDrink: input.query.normalizedDrink,
    quantity: input.query.quantity,
    size: input.query.size ?? "",
    temperature: input.query.temperature ?? ""
  };

  return spec.entryUrl.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, key: string) =>
    encodeURIComponent(String(values[key] ?? ""))
  );
}

export class BrowserSourceProvider implements CoffeeSourceProvider {
  constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly spec: BrowserSourceSpec
  ) {}

  async search(input: {
    query: CoffeeQuery;
    config: CoffeePriceConfig;
    address: AddressConfig;
  }): Promise<OfferCandidate[] | ProviderStatus> {
    const { chromium } = await import("playwright-core");
    const url = buildEntryUrl(this.spec, input);
    const context = await chromium.launchPersistentContext(input.config.browserProfilePath, {
      channel: this.spec.browser?.channel === "chromium" ? undefined : this.spec.browser?.channel ?? "msedge",
      headless: this.spec.browser?.headless ?? false
    });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(url, {
        waitUntil: this.spec.browser?.waitUntil ?? "domcontentloaded",
        timeout: this.spec.browser?.timeoutMs ?? 60_000
      });
      await applyBrowserSearchAction(page, {
        search: this.spec.browser?.search,
        searchText: input.query.drink
      });
      await waitForOptionalSelector(
        page,
        this.spec.browser?.waitForSelector,
        this.spec.browser?.timeoutMs ?? 60_000
      );
      const snapshot = extractPlatformSnapshotFromHtml(await page.content(), this.spec, page.url());
      return parsePlatformSnapshot(snapshot);
    } finally {
      await context.close();
    }
  }
}

function detectStatus(
  $: cheerio.CheerioAPI,
  spec: BrowserSourceSpec
): PlatformSnapshot | null {
  if (countStatusMatch($, spec, "loginRequired") > 0) {
    return {
      source: spec.source,
      status: "login_required",
      message: `${spec.source} 登录态失效，需要重新登录。`
    };
  }
  if (countStatusMatch($, spec, "captchaRequired") > 0) {
    return {
      source: spec.source,
      status: "captcha_required",
      message: `${spec.source} 出现验证码，需要人工处理。`
    };
  }
  if (countStatusMatch($, spec, "noStock") > 0) {
    return {
      source: spec.source,
      status: "no_stock",
      message: `${spec.source} 附近门店无货。`
    };
  }
  if (countStatusMatch($, spec, "unavailable") > 0) {
    return {
      source: spec.source,
      status: "unavailable",
      message: `${spec.source} 页面暂不可用，请稍后重试或重新捕获。`
    };
  }
  return null;
}

function auditOfferRow(
  $: cheerio.CheerioAPI,
  row: cheerio.Cheerio<AnyNode>,
  selectors: BrowserSourceSelectors,
  index: number
): BrowserSourceSelectorAuditRow {
  const fields = selectors.fields;
  const fieldMatches = Object.fromEntries(
    Object.entries(fields)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([name, selector]) => [name, row.find(selector).length])
  );
  const missingRequiredFields = ["brand", "storeName", "drinkName", "fulfillment", "itemPrice"]
    .filter((name) => fieldMatches[name] === 0 || !text(row, fields[name as keyof typeof fields] ?? ""));

  return {
    index,
    fieldMatches,
    missingRequiredFields
  };
}

function countSelector($: cheerio.CheerioAPI, selector: string | undefined): number {
  return selector ? $(selector).length : 0;
}

function countStatusMatch(
  $: cheerio.CheerioAPI,
  spec: BrowserSourceSpec,
  name: "loginRequired" | "captchaRequired" | "noStock" | "unavailable"
): number {
  const selector = name === "unavailable" ? undefined : spec.selectors[name];
  const selectorCount = countSelector($, selector);
  const patterns = spec.selectors.statusTextPatterns?.[name] ?? [];
  if (patterns.length === 0) {
    return selectorCount;
  }

  const pageText = $.root().text();
  const titleText = $("title").first().text();
  const combinedText = `${titleText}\n${pageText}`;
  const textCount = patterns.filter((pattern) => matchesTextPattern(combinedText, pattern)).length;
  return selectorCount + textCount;
}

function matchesTextPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return value.toLowerCase().includes(pattern.toLowerCase());
  }
}

function extractOffer(
  $: cheerio.CheerioAPI,
  row: cheerio.Cheerio<AnyNode>,
  spec: BrowserSourceSpec,
  baseUrl?: string
): PlatformSnapshotOffer | null {
  const fields = spec.selectors.fields;
  const brand = text(row, fields.brand);
  const storeName = text(row, fields.storeName);
  const drinkName = text(row, fields.drinkName);
  const fulfillment = parseFulfillment(text(row, fields.fulfillment));
  const itemPrice = parseMoney(text(row, fields.itemPrice));

  if (!brand || !storeName || !drinkName || !fulfillment || itemPrice === null) {
    return null;
  }

  return {
    brand,
    storeName,
    drinkName,
    normalizedDrink: fields.normalizedDrink ? text(row, fields.normalizedDrink) || normalizeDrink(drinkName) : normalizeDrink(drinkName),
    size: fields.size ? text(row, fields.size) || null : null,
    fulfillment,
    itemPrice,
    quantity: fields.quantity ? parseQuantity(text(row, fields.quantity)) : 1,
    deliveryFee: fields.deliveryFee ? parseMoney(text(row, fields.deliveryFee)) ?? undefined : undefined,
    packagingFee: fields.packagingFee ? parseMoney(text(row, fields.packagingFee)) ?? undefined : undefined,
    discounts: extractDiscounts($, row, spec),
    distanceText: fields.distanceText ? text(row, fields.distanceText) || undefined : undefined,
    etaText: fields.etaText ? text(row, fields.etaText) || undefined : undefined,
    purchaseUrl: fields.purchaseUrl ? resolveUrl(attrOrText(row, fields.purchaseUrl, "href"), baseUrl) : undefined
  };
}

function extractDiscounts(
  $: cheerio.CheerioAPI,
  row: cheerio.Cheerio<AnyNode>,
  spec: BrowserSourceSpec
) {
  const discountSpec = spec.selectors.discounts;
  if (!discountSpec) {
    return [];
  }
  return row
    .find(discountSpec.rows)
    .map((_index, element) => {
      const discount = $(element);
      const amount = parseMoney(text(discount, discountSpec.amount));
      if (amount === null) {
        return null;
      }
      return {
        label: text(discount, discountSpec.label) || "优惠",
        amount: Math.abs(amount)
      };
    })
    .get()
    .filter((discount): discount is { label: string; amount: number } => discount !== null);
}

function text(root: cheerio.Cheerio<AnyNode>, selector: string): string {
  return root.find(selector).first().text().trim();
}

function attrOrText(
  root: cheerio.Cheerio<AnyNode>,
  selector: string,
  attrName: string
): string {
  const element = root.find(selector).first();
  return (element.attr(attrName) ?? element.text()).trim();
}

function parseMoney(value: string): number | null {
  const match = value.replace(/,/g, "").match(/-?\s*[￥¥]?\s*(\d+(?:\.\d+)?)/);
  return match?.[1] ? Number.parseFloat(match[1]) : null;
}

function parseQuantity(value: string): number {
  const match = value.match(/(\d+)/);
  return match?.[1] ? Math.max(1, Number.parseInt(match[1], 10)) : 1;
}

function parseFulfillment(value: string): Fulfillment | null {
  if (/自取|pickup/i.test(value)) {
    return "pickup";
  }
  if (/外卖|配送|delivery/i.test(value)) {
    return "delivery";
  }
  return null;
}

function normalizeDrink(value: string): string {
  if (/美式/.test(value)) return "americano";
  if (/拿铁/i.test(value)) return "latte";
  if (/澳白|馥芮白/.test(value)) return "flat_white";
  if (/卡布/.test(value)) return "cappuccino";
  if (/摩卡/.test(value)) return "mocha";
  return value.trim().toLowerCase();
}

function resolveUrl(value: string, baseUrl?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!baseUrl) {
    return value;
  }
  return new URL(value, baseUrl).toString();
}
