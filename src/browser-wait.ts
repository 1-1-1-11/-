export interface OptionalSelectorPage {
  waitForSelector(selector: string, options: { timeout: number }): Promise<unknown>;
}

export async function waitForOptionalSelector(
  page: OptionalSelectorPage,
  selector: string | undefined,
  timeoutMs: number
): Promise<void> {
  if (!selector) {
    return;
  }
  try {
    await page.waitForSelector(selector, { timeout: timeoutMs });
  } catch (error) {
    if (isSelectorTimeout(error)) {
      return;
    }
    throw error;
  }
}

function isSelectorTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "TimeoutError" || /timeout .*wait(?:ing)? for selector|waiting for selector.*timeout/i.test(error.message);
}
