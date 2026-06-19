import type { PriceParts } from "./types.js";

export function calculateOfferTotal(parts: PriceParts): number {
  const subtotal = parts.itemPrice * parts.quantity;
  const fees =
    parts.fulfillment === "delivery"
      ? (parts.deliveryFee ?? 0) + (parts.packagingFee ?? 0)
      : 0;
  const discountTotal = (parts.discounts ?? []).reduce((sum, discount) => sum + discount.amount, 0);
  return roundCurrency(Math.max(0, subtotal + fees - discountTotal));
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
