import { spawn } from "node:child_process";
import { platform } from "node:os";

import { isReferencePriceSource } from "./source-classification.js";
import type { PricedOffer, SearchResult } from "./types.js";

export interface PurchasePageOpener {
  open(url: string): Promise<void>;
}

export interface PurchasePageSelection {
  offer: PricedOffer;
  url: string;
}

export type PurchasePageOpenResult =
  | { status: "opened"; selection: PurchasePageSelection }
  | { status: "no_purchase_url"; message: string }
  | { status: "open_failed"; message: string };

export function selectLowestPurchasePage(result: SearchResult): PurchasePageSelection | null {
  const candidates = [...result.delivery, ...result.pickup]
    .map((offer) => ({ offer, url: normalizePurchaseUrl(offer.purchaseUrl) }))
    .filter((candidate): candidate is PurchasePageSelection => (
      candidate.url !== null && isActionablePurchaseSource(candidate.offer)
    ))
    .sort((left, right) => left.offer.totalPrice - right.offer.totalPrice);

  return candidates[0] ?? null;
}

export async function openLowestPurchasePage(
  result: SearchResult,
  opener: PurchasePageOpener = systemPurchasePageOpener
): Promise<PurchasePageOpenResult> {
  const selection = selectLowestPurchasePage(result);
  if (!selection) {
    return {
      status: "no_purchase_url",
      message: hasReferencePurchaseUrl(result)
        ? "当前只有本地价格库或城市参考价等参考源链接，不自动当作实时可下单购买页。请配置瑞幸/美团/OrderWise 等实时源后再打开。"
        : "没有可打开的 http/https 购买链接"
    };
  }

  try {
    await opener.open(selection.url);
    return { status: "opened", selection };
  } catch (error) {
    return {
      status: "open_failed",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export const systemPurchasePageOpener: PurchasePageOpener = {
  async open(url: string): Promise<void> {
    const command = getOpenCommand(url);
    await spawnDetached(command.file, command.args);
  }
};

function normalizePurchaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isActionablePurchaseSource(offer: PricedOffer): boolean {
  return !isReferencePriceSource(offer.source);
}

function hasReferencePurchaseUrl(result: SearchResult): boolean {
  return [...result.delivery, ...result.pickup].some((offer) => (
    !isActionablePurchaseSource(offer) && normalizePurchaseUrl(offer.purchaseUrl) !== null
  ));
}

function getOpenCommand(url: string): { file: string; args: string[] } {
  if (platform() === "win32") {
    return { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  }
  if (platform() === "darwin") {
    return { file: "open", args: [url] };
  }
  return { file: "xdg-open", args: [url] };
}

function spawnDetached(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
