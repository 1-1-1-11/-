import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { redactNetworkLogUrl } from "./browser-network-log.js";
import { applyBrowserSearchAction } from "./browser-search-action.js";
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
  searchText?: string;
  manualWaitMs?: number;
}

export interface BrowserPageLoadResult {
  url: string;
  html: string;
  networkLog?: BrowserNetworkLogEntry[];
}

export type BrowserPageLoader = (request: BrowserPageLoadRequest) => Promise<BrowserPageLoadResult>;

export interface BrowserNetworkLogEntry {
  event: "response" | "requestfailed";
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  statusText?: string;
  failureText?: string;
}

export interface CaptureBrowserSourceInput {
  configPath: string;
  source: keyof SourceConfig;
  message: string;
  htmlPath: string;
  snapshotPath: string;
  auditPath?: string;
  networkPath?: string;
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
  networkPath?: string;
  networkLog?: BrowserNetworkLogEntry[];
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
    searchText: query.drink,
    manualWaitMs: input.manualWaitMs
  });
  const snapshot = extractPlatformSnapshotFromHtml(page.html, spec, page.url);
  const selectorAudit = auditBrowserSourceHtml(page.html, spec);

  await writeTextFile(input.htmlPath, page.html);
  await writeTextFile(input.snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  if (input.auditPath) {
    await writeTextFile(input.auditPath, `${JSON.stringify(selectorAudit, null, 2)}\n`);
  }
  if (input.networkPath) {
    await writeTextFile(input.networkPath, `${JSON.stringify(page.networkLog ?? [], null, 2)}\n`);
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
    networkPath: input.networkPath,
    networkLog: page.networkLog,
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
    const networkLog = attachNetworkLog(page);
    await page.goto(request.url, {
      waitUntil: request.spec.browser?.waitUntil ?? "domcontentloaded",
      timeout: request.spec.browser?.timeoutMs ?? 60_000
    });
    await applyBrowserSearchAction(page, {
      search: request.spec.browser?.search,
      searchText: request.searchText
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
      html: await page.content(),
      networkLog
    };
  } finally {
    await context.close();
  }
}

function attachNetworkLog(page: {
  on(
    event: "response",
    handler: (response: {
      url(): string;
      status(): number;
      statusText(): string;
      request(): { method(): string; resourceType(): string };
    }) => void
  ): void;
  on(
    event: "requestfailed",
    handler: (request: {
      url(): string;
      method(): string;
      resourceType(): string;
      failure(): { errorText: string } | null;
    }) => void
  ): void;
}): BrowserNetworkLogEntry[] {
  const entries: BrowserNetworkLogEntry[] = [];
  page.on("response", (response) => {
    const request = response.request();
    const resourceType = request.resourceType();
    const status = response.status();
    if (!shouldRecordResponse(resourceType, status)) {
      return;
    }
    entries.push({
      event: "response",
      url: redactNetworkLogUrl(response.url()),
      method: request.method(),
      resourceType,
      status,
      statusText: response.statusText()
    });
  });
  page.on("requestfailed", (request) => {
    entries.push({
      event: "requestfailed",
      url: redactNetworkLogUrl(request.url()),
      method: request.method(),
      resourceType: request.resourceType(),
      failureText: request.failure()?.errorText
    });
  });
  return entries;
}

function shouldRecordResponse(resourceType: string, status: number): boolean {
  if (status >= 400) {
    return true;
  }
  return resourceType === "document" || resourceType === "fetch" || resourceType === "xhr";
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
