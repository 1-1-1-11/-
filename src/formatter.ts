import type { Discount, PricedOffer, SearchResult } from "./types.js";

export function formatWechatReply(result: SearchResult): string {
  const lines: string[] = [
    `咖啡查价：${result.query.drink} x${result.query.quantity} @ ${result.resolvedAddress.label}`
  ];

  if (result.delivery.length === 0 && result.pickup.length === 0) {
    if (result.warnings.length > 0) {
      lines.push("当前无法完成真实查价，所有已启用渠道都没有返回可比价格。");
      lines.push("不会编造价格，也不会绕过登录、人机验证或平台风控。");
    } else {
      lines.push("没有找到可比价格。");
    }
  } else {
    appendSection(lines, "外卖到手价", result.delivery);
    appendSection(lines, "自取价", result.pickup);
  }

  if (result.warnings.length > 0) {
    lines.push("", "需要处理：", ...result.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join("\n");
}

function appendSection(lines: string[], title: string, offers: PricedOffer[]): void {
  lines.push("", `${title} Top ${offers.length}`);
  if (offers.length === 0) {
    lines.push("- 暂无可比结果");
    return;
  }

  offers.forEach((offer, index) => {
    lines.push(
      `${index + 1}. ${offer.brand}｜${offer.storeName}｜${offer.drinkName}${offer.size ? ` ${offer.size}` : ""}｜￥${formatMoney(offer.totalPrice)}`
    );
    lines.push(`   费用: ${formatPriceParts(offer)}`);
    if (offer.distanceText || offer.etaText) {
      lines.push(`   距离/时间: ${[offer.distanceText, offer.etaText].filter(Boolean).join(" / ")}`);
    }
    if (offer.purchaseUrl) {
      lines.push(`   购买页: ${offer.purchaseUrl}`);
    }
  });
}

function formatPriceParts(offer: PricedOffer): string {
  const parts = [`商品￥${formatMoney(offer.itemPrice)} x${offer.quantity}`];
  if (offer.fulfillment === "delivery") {
    parts.push(`配送￥${formatMoney(offer.deliveryFee ?? 0)}`);
    parts.push(`包装￥${formatMoney(offer.packagingFee ?? 0)}`);
  }
  for (const discount of offer.discounts ?? []) {
    parts.push(`-${formatDiscount(discount)}`);
  }
  return parts.join(" + ").replace(/\+ -/g, "- ");
}

function formatDiscount(discount: Discount): string {
  return `${discount.label}￥${formatMoney(discount.amount)}`;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}
