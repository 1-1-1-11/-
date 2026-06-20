import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { waitForOptionalSelector } from "./browser-wait.js";
import { readConfig } from "./config.js";
import { setBrowserSourceEntryUrl } from "./config-set-url.js";
import { parseCoffeeCommand } from "./query-parser.js";
import {
  auditBrowserSourceHtml,
  buildEntryUrl,
  extractPlatformSnapshotFromHtml
} from "./providers/browser-source-provider.js";
import type { BrowserSourceSelectorAudit } from "./providers/browser-source-provider.js";
import type {
  AddressConfig,
  BrowserSourceSpec,
  CoffeePriceConfig,
  PlatformSnapshot,
  SourceConfig
} from "./types.js";

export interface BrowserPageLoadRequest {
  url: string;
  profilePath: string;
  spec: BrowserSourceSpec;
  manualWaitMs?: number;
}

export interface BrowserPageLoadResult {
  url: string;
  html: string;
}

export type BrowserPageLoader = (request: BrowserPageLoadRequest) => Promise<BrowserPageLoadResult>;

export interface CaptureBrowserSourceInput {
  configPath: string;
  source: keyof SourceConfig;
  message: string;
  htmlPath: string;
  snapshotPath: string;
  auditPath?: string;
  entryUrlOverride?: string;
  saveEntryUrl?: boolean;
  manualWaitMs?: number;
  pageLoader?: BrowserPageLoader;
}

export interface CaptureBrowserSourceResult {
  url: string;
  htmlPath: string;
  snapshotPath: string;
  auditPath?: string;
  snapshot: PlatformSnapshot;
  selectorAudit: BrowserSourceSelectorAudit;
}

export async function captureBrowserSource(
  input: CaptureBrowserSourceInput
): Promise<CaptureBrowserSourceResult> {
  if (input.saveEntryUrl && !input.entryUrlOverride) {
    throw new Error("saveEntryUrl requires entryUrlOverride");
  }

  const config = await readConfig(input.configPath);
  const query = parseCoffeeCommand(input.message);
  const address = resolveAddress(config, query.addressAlias);
  const spec = config.browserSources?.[input.source];
  if (!spec) {
    throw new Error(`没有配置 ${input.source} 的 browserSources，无法捕获页面`);
  }

  const entryUrl = input.entryUrlOverride ?? buildEntryUrl(spec, { address, query });
  const loader = input.pageLoader ?? loadPageWithPersistentProfile;
  const page = await loader({
    url: entryUrl,
    profilePath: config.browserProfilePath,
    spec,
    manualWaitMs: input.manualWaitMs
  });
  const snapshot = extractPlatformSnapshotFromHtml(page.html, spec, page.url);
  const selectorAudit = auditBrowserSourceHtml(page.html, spec);

  await writeTextFile(input.htmlPath, page.html);
  await writeTextFile(input.snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  if (input.auditPath) {
    await writeTextFile(input.auditPath, `${JSON.stringify(selectorAudit, null, 2)}\n`);
  }
  if (input.saveEntryUrl && input.entryUrlOverride) {
    const updated = setBrowserSourceEntryUrl(config, input.source, input.entryUrlOverride);
    await writeTextFile(input.configPath, `${JSON.stringify(updated.config, null, 2)}\n`);
  }

  return {
    url: page.url,
    htmlPath: input.htmlPath,
    snapshotPath: input.snapshotPath,
    auditPath: input.auditPath,
    snapshot,
    selectorAudit
  };
}

async function loadPageWithPersistentProfile(
  request: BrowserPageLoadRequest
): Promise<BrowserPageLoadResult> {
  const { chromium } = await import("playwright-core");
  const context = await chromium.launchPersistentContext(request.profilePath, {
    channel: request.spec.browser?.channel === "chromium" ? undefined : request.spec.browser?.channel ?? "msedge",
    headless: request.spec.browser?.headless ?? false
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(request.url, {
      waitUntil: request.spec.browser?.waitUntil ?? "domcontentloaded",
      timeout: request.spec.browser?.timeoutMs ?? 60_000
    });
    if (request.manualWaitMs && request.manualWaitMs > 0) {
      await page.waitForTimeout(request.manualWaitMs);
    }
    await waitForOptionalSelector(
      page,
      request.spec.browser?.waitForSelector,
      request.spec.browser?.timeoutMs ?? 60_000
    );
    return {
      url: page.url(),
      html: await page.content()
    };
  } finally {
    await context.close();
  }
}

function resolveAddress(config: CoffeePriceConfig, addressAlias: string | null): AddressConfig {
  const alias = addressAlias ?? config.defaultAddressAlias;
  const address = config.addresses.find((candidate) => candidate.alias === alias);
  if (address) {
    return address;
  }
  if (config.addresses[0]) {
    return config.addresses[0];
  }
  throw new Error("没有配置常用地址，无法捕获页面");
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
