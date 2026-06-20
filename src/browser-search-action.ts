import type { BrowserSourceSpec } from "./types.js";

type BrowserSearchConfig = NonNullable<BrowserSourceSpec["browser"]>["search"];

export interface BrowserSearchActionPage {
  locator(selector: string): BrowserSearchActionLocator;
  waitForTimeout(ms: number): Promise<void>;
}

export interface BrowserSearchActionLocator {
  first(): BrowserSearchActionLocator;
  fill(value: string): Promise<void>;
  click(): Promise<void>;
  press(key: string): Promise<void>;
}

export async function applyBrowserSearchAction(
  page: BrowserSearchActionPage,
  input: {
    search?: BrowserSearchConfig;
    searchText?: string;
  }
): Promise<void> {
  if (!input.search || !input.searchText) {
    return;
  }

  const searchInput = page.locator(input.search.inputSelector).first();
  await searchInput.fill(input.searchText);
  if (input.search.submitSelector) {
    await page.locator(input.search.submitSelector).first().click();
  } else {
    await searchInput.press("Enter");
  }

  const waitAfterMs = input.search.waitAfterMs ?? 3000;
  if (waitAfterMs > 0) {
    await page.waitForTimeout(waitAfterMs);
  }
}
