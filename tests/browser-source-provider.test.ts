import assert from "node:assert/strict";
import test from "node:test";

import {
  auditBrowserSourceHtml,
  buildEntryUrl,
  extractPlatformSnapshotFromHtml
} from "../src/providers/browser-source-provider.js";
import type { BrowserSourceSpec } from "../src/types.js";

const spec: BrowserSourceSpec = {
  source: "meituan",
  entryUrl:
    "https://example.com/search?address={{addressQuery}}&drink={{drink}}&quantity={{quantity}}",
  selectors: {
    loginRequired: "[data-login-required]",
    captchaRequired: "[data-captcha-required]",
    noStock: "[data-no-stock]",
    offerRows: "[data-offer]",
    fields: {
      brand: "[data-brand]",
      storeName: "[data-store]",
      drinkName: "[data-drink]",
      normalizedDrink: "[data-normalized-drink]",
      size: "[data-size]",
      fulfillment: "[data-fulfillment]",
      itemPrice: "[data-item-price]",
      quantity: "[data-quantity]",
      deliveryFee: "[data-delivery-fee]",
      packagingFee: "[data-packaging-fee]",
      distanceText: "[data-distance]",
      etaText: "[data-eta]",
      purchaseUrl: "[data-purchase-url]"
    },
    discounts: {
      rows: "[data-discount]",
      label: "[data-discount-label]",
      amount: "[data-discount-amount]"
    }
  }
};

const textStatusSpec: BrowserSourceSpec = {
  ...spec,
  selectors: {
    ...spec.selectors,
    statusTextPatterns: {
      loginRequired: ["饿了么-登录", "请登录"],
      captchaRequired: ["验证码", "安全验证"],
      noStock: ["附近门店无货"],
      unavailable: ["网络好像不太给力", "请稍后再试"]
    }
  }
};

test("detects login, captcha, and no-stock states before extracting offers", () => {
  assert.deepEqual(
    extractPlatformSnapshotFromHtml('<main data-login-required>login</main>', spec),
    {
      source: "meituan",
      status: "login_required",
      message: "meituan 登录态失效，需要重新登录。"
    }
  );

  assert.deepEqual(
    extractPlatformSnapshotFromHtml('<main data-captcha-required>captcha</main>', spec),
    {
      source: "meituan",
      status: "captcha_required",
      message: "meituan 出现验证码，需要人工处理。"
    }
  );

  assert.deepEqual(
    extractPlatformSnapshotFromHtml('<main data-no-stock>sold out</main>', spec),
    {
      source: "meituan",
      status: "no_stock",
      message: "meituan 附近门店无货。"
    }
  );
});

test("detects platform status from configured page text patterns", () => {
  assert.deepEqual(
    extractPlatformSnapshotFromHtml("<html><title>饿了么-登录</title></html>", textStatusSpec),
    {
      source: "meituan",
      status: "login_required",
      message: "meituan 登录态失效，需要重新登录。"
    }
  );

  assert.deepEqual(
    extractPlatformSnapshotFromHtml("<main>您的网络好像不太给力，请稍后再试</main>", textStatusSpec),
    {
      source: "meituan",
      status: "unavailable",
      message: "meituan 页面暂不可用，请稍后重试或重新捕获。"
    }
  );

  const audit = auditBrowserSourceHtml("<html><title>饿了么-登录</title></html>", textStatusSpec);
  assert.equal(audit.statusMatches.loginRequired, 1);
  assert.equal(audit.statusMatches.unavailable, 0);
});

test("extracts comparable offers from configured selectors", () => {
  const snapshot = extractPlatformSnapshotFromHtml(
    `
      <article data-offer>
        <span data-brand>库迪</span>
        <span data-store>库迪 科技园店</span>
        <span data-drink>冰美式</span>
        <span data-normalized-drink>americano</span>
        <span data-size>中杯</span>
        <span data-fulfillment>外卖</span>
        <span data-item-price>￥9.90</span>
        <span data-quantity>2杯</span>
        <span data-delivery-fee>配送 ¥2</span>
        <span data-packaging-fee>包装 ¥1.5</span>
        <span data-distance>600m</span>
        <span data-eta>28分钟</span>
        <a data-purchase-url href="/order/cotti">购买</a>
        <div data-discount>
          <span data-discount-label>平台券</span>
          <span data-discount-amount>-￥3</span>
        </div>
      </article>
      <article data-offer>
        <span data-brand>瑞幸</span>
        <span data-store>瑞幸 科技园店</span>
        <span data-drink>冰美式</span>
        <span data-normalized-drink>americano</span>
        <span data-size>中杯</span>
        <span data-fulfillment>自取</span>
        <span data-item-price>12.9</span>
        <a data-purchase-url href="https://brand.example/luckin">购买</a>
      </article>
    `,
    spec,
    "https://example.com/search"
  );

  assert.ok(Array.isArray(snapshot.offers));
  assert.equal(snapshot.offers.length, 2);
  assert.equal(snapshot.offers[0]?.fulfillment, "delivery");
  assert.equal(snapshot.offers[0]?.itemPrice, 9.9);
  assert.equal(snapshot.offers[0]?.quantity, 2);
  assert.equal(snapshot.offers[0]?.deliveryFee, 2);
  assert.equal(snapshot.offers[0]?.packagingFee, 1.5);
  assert.equal(snapshot.offers[0]?.discounts?.[0]?.amount, 3);
  assert.equal(snapshot.offers[0]?.purchaseUrl, "https://example.com/order/cotti");
  assert.equal(snapshot.offers[1]?.fulfillment, "pickup");
  assert.equal(snapshot.offers[1]?.purchaseUrl, "https://brand.example/luckin");
});

test("fills browser entry URL templates from address and query", () => {
  const url = buildEntryUrl(spec, {
    address: { alias: "公司", label: "公司", query: "深圳南山区科技园" },
    query: {
      rawText: "查公司附近冰美式 两杯",
      addressAlias: "公司",
      drink: "冰美式",
      normalizedDrink: "americano",
      temperature: "冰",
      size: null,
      quantity: 2,
      fulfillment: "both"
    }
  });

  assert.equal(
    url,
    "https://example.com/search?address=%E6%B7%B1%E5%9C%B3%E5%8D%97%E5%B1%B1%E5%8C%BA%E7%A7%91%E6%8A%80%E5%9B%AD&drink=%E5%86%B0%E7%BE%8E%E5%BC%8F&quantity=2"
  );
});

test("audits selector coverage for captured platform HTML", () => {
  const audit = auditBrowserSourceHtml(
    `
      <main data-captcha-required>captcha banner</main>
      <article data-offer>
        <span data-brand>Cotti</span>
        <span data-store>Tech Park</span>
        <span data-drink>Iced Americano</span>
        <span data-fulfillment>delivery</span>
        <span data-item-price>¥9.90</span>
      </article>
      <article data-offer>
        <span data-brand>Luckin</span>
        <span data-store>Tech Park</span>
      </article>
    `,
    spec
  );

  assert.equal(audit.source, "meituan");
  assert.equal(audit.statusMatches.captchaRequired, 1);
  assert.equal(audit.statusMatches.unavailable, 0);
  assert.equal(audit.offerRows.selector, "[data-offer]");
  assert.equal(audit.offerRows.count, 2);
  assert.deepEqual(audit.rows[0]?.missingRequiredFields, []);
  assert.deepEqual(audit.rows[1]?.missingRequiredFields, [
    "drinkName",
    "fulfillment",
    "itemPrice"
  ]);
  assert.equal(audit.rows[1]?.fieldMatches.brand, 1);
});
