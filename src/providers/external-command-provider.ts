import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { fetch } from "undici";

import { parsePlatformSnapshot } from "./platform-snapshot-provider.js";
import type {
  AddressConfig,
  CoffeePriceConfig,
  CoffeeQuery,
  CoffeeSourceProvider,
  ExternalSourceConfig,
  OfferCandidate,
  PlatformSnapshot,
  ProviderStatus
} from "../types.js";

export interface ExternalPriceSourceRequest {
  query: CoffeeQuery;
  address: AddressConfig;
}

export class ExternalCommandProvider implements CoffeeSourceProvider {
  public readonly id: string;
  public readonly label: string;

  constructor(private readonly source: ExternalSourceConfig) {
    this.id = source.id;
    this.label = source.label ?? source.id;
  }

  async search(input: {
    query: CoffeeQuery;
    config: CoffeePriceConfig;
    address: AddressConfig;
  }): Promise<OfferCandidate[] | ProviderStatus> {
    try {
      const snapshot = await runExternalSource(this.source, {
        query: input.query,
        address: input.address
      });
      return parsePlatformSnapshot(snapshot);
    } catch (error) {
      return {
        status: "unavailable",
        message: `${this.label}不可用：${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

async function runExternalSource(
  source: ExternalSourceConfig,
  request: ExternalPriceSourceRequest
): Promise<PlatformSnapshot> {
  if (source.type === "mcp") {
    return runMcpSource(source, request);
  }
  if (source.type === "http" || source.url) {
    return runHttpSource(source, request);
  }
  const stdout = await spawnJsonCommand(source, request);
  const parsed = JSON.parse(stdout) as PlatformSnapshot;
  return {
    ...parsed,
    source: parsed.source || source.id
  };
}

async function runMcpSource(
  source: ExternalSourceConfig,
  request: ExternalPriceSourceRequest
): Promise<PlatformSnapshot> {
  if (source.transport === "stdio") {
    if (!source.command) {
      throw new Error("stdio mcp external source requires command");
    }
  } else if (!source.endpoint) {
    throw new Error("http mcp external source requires endpoint");
  }
  if (!source.toolName) {
    throw new Error("mcp external source requires toolName");
  }

  const client = new Client({
    name: `coffee-price-${source.id}-mcp-source`,
    version: "0.1.0"
  });
  const transport = await createMcpTransport(source);
  try {
    await client.connect(transport);
    const result = await client.callTool(
      {
        name: source.toolName,
        arguments: renderToolArguments(source.toolArguments ?? defaultToolArguments(), request)
      },
      undefined,
      { timeout: source.timeoutMs ?? 120_000 }
    );
    return normalizeMcpSnapshot(result, source);
  } finally {
    await client.close();
  }
}

async function createMcpTransport(source: ExternalSourceConfig): Promise<Transport> {
  if (source.transport === "stdio") {
    return new StdioClientTransport({
      command: source.command!,
      args: source.args ?? [],
      cwd: source.cwd,
      stderr: "pipe",
      env: await buildStdioEnv(source)
    });
  }
  return new StreamableHTTPClientTransport(new URL(source.endpoint!), {
    requestInit: {
      headers: await buildMcpHeaders(source)
    }
  });
}

function spawnJsonCommand(source: ExternalSourceConfig, request: ExternalPriceSourceRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!source.command) {
      reject(new Error("command external source requires command"));
      return;
    }
    const child = spawn(source.command, source.args ?? [], {
      cwd: source.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`external source timed out after ${source.timeoutMs ?? 30_000}ms`));
    }, source.timeoutMs ?? 30_000);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `external source exited ${code}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
    child.stdin.end(`${JSON.stringify(request)}\n`, "utf8");
  });
}

async function runHttpSource(
  source: ExternalSourceConfig,
  request: ExternalPriceSourceRequest
): Promise<PlatformSnapshot> {
  if (!source.url) {
    throw new Error("http external source requires url");
  }

  const timeoutMs = source.timeoutMs ?? 30_000;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(source.url, {
      method: source.method ?? "POST",
      headers: await buildHttpHeaders(source),
      body: JSON.stringify(request),
      signal: abort.signal
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 300) || response.statusText}`);
    }
    const parsed = JSON.parse(body) as unknown;
    return normalizeHttpSnapshot(parsed, source.id);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`http external source timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function buildHttpHeaders(source: ExternalSourceConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(source.headers ?? {})
  };
  for (const [header, envName] of Object.entries(source.headerEnv ?? {})) {
    const value = process.env[envName];
    if (value) {
      headers[header] = value;
    }
  }
  const bearerToken = await readBearerToken(source);
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }
  return headers;
}

async function buildMcpHeaders(source: ExternalSourceConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    ...(source.headers ?? {})
  };
  for (const [header, envName] of Object.entries(source.headerEnv ?? {})) {
    const value = process.env[envName];
    if (value) {
      headers[header] = value;
    }
  }
  const bearerToken = await readBearerToken(source);
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }
  return headers;
}

async function buildStdioEnv(source: ExternalSourceConfig): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    ...getDefaultEnvironment(),
    ...(source.env ?? {})
  };
  for (const [childName, parentName] of Object.entries(source.envFrom ?? {})) {
    const value = process.env[parentName];
    if (value !== undefined) {
      env[childName] = value;
    }
  }
  const bearerToken = await readBearerToken(source);
  if (bearerToken) {
    env[source.tokenEnvName ?? source.bearerTokenEnv ?? "BEARER_TOKEN"] = bearerToken;
  }
  return env;
}

async function readBearerToken(source: ExternalSourceConfig): Promise<string | null> {
  if (source.bearerTokenEnv && process.env[source.bearerTokenEnv]) {
    return process.env[source.bearerTokenEnv]!.trim();
  }
  if (!source.bearerTokenFile) {
    return null;
  }
  try {
    return (await readFile(source.bearerTokenFile, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

function normalizeHttpSnapshot(value: unknown, sourceId: string): PlatformSnapshot {
  const payload = unwrapHttpPayload(value);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("HTTP source did not return a PlatformSnapshot JSON object");
  }
  const snapshot = payload as Partial<PlatformSnapshot>;
  if (!snapshot.status && !Array.isArray(snapshot.offers)) {
    throw new Error("HTTP source response must contain offers[] or status");
  }
  return {
    ...snapshot,
    source: snapshot.source ?? sourceId
  } as PlatformSnapshot;
}

function normalizeMcpSnapshot(value: unknown, source: ExternalSourceConfig): PlatformSnapshot {
  const selected = source.toolResultPath
    ? readPath(extractMcpPayload(value), source.toolResultPath)
    : extractMcpPayload(value);
  const payload = unwrapHttpPayload(selected);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("MCP source did not return a PlatformSnapshot JSON object");
  }
  const snapshot = payload as Partial<PlatformSnapshot>;
  if (!snapshot.status && !Array.isArray(snapshot.offers)) {
    throw new Error("MCP source response must contain offers[] or status");
  }
  return {
    ...snapshot,
    source: snapshot.source ?? source.id
  } as PlatformSnapshot;
}

function extractMcpPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  const object = value as Record<string, unknown>;
  if (object.structuredContent) {
    return object.structuredContent;
  }
  if (Array.isArray(object.content)) {
    for (const entry of object.content) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const text = (entry as { text?: unknown }).text;
      if (typeof text === "string") {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
    }
  }
  if (object.data) {
    return object.data;
  }
  if (object.result) {
    return object.result;
  }
  return value;
}

function unwrapHttpPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const object = value as Record<string, unknown>;
  if (object.snapshot) {
    return unwrapHttpPayload(object.snapshot);
  }
  if (object.data && typeof object.data === "object") {
    return unwrapHttpPayload(object.data);
  }
  if (object.result && typeof object.result === "object") {
    return unwrapHttpPayload(object.result);
  }
  return value;
}

function defaultToolArguments(): Record<string, unknown> {
  return {
    message: "{{query.rawText}}",
    drink: "{{query.drink}}",
    normalizedDrink: "{{query.normalizedDrink}}",
    size: "{{query.size}}",
    quantity: "{{query.quantity}}",
    address: "{{address.query}}"
  };
}

function renderToolArguments(
  value: unknown,
  request: ExternalPriceSourceRequest
): Record<string, unknown> {
  const rendered = renderTemplateValue(value, request);
  if (!rendered || typeof rendered !== "object" || Array.isArray(rendered)) {
    throw new Error("mcp toolArguments must render to an object");
  }
  return rendered as Record<string, unknown>;
}

function renderTemplateValue(value: unknown, request: ExternalPriceSourceRequest): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => renderTemplateValue(entry, request));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        renderTemplateValue(entry, request)
      ])
    );
  }
  if (typeof value !== "string") {
    return value;
  }
  return renderTemplateString(value, request);
}

function renderTemplateString(value: string, request: ExternalPriceSourceRequest): unknown {
  const single = value.match(/^{{\s*([^}]+?)\s*}}$/);
  if (single) {
    return readTemplatePath(single[1], request);
  }
  return value.replace(/{{\s*([^}]+?)\s*}}/g, (_match, path: string) => {
    const replacement = readTemplatePath(path, request);
    return replacement === undefined || replacement === null ? "" : String(replacement);
  });
}

function readTemplatePath(path: string, request: ExternalPriceSourceRequest): unknown {
  return readPath({ query: request.query, address: request.address }, path);
}

function readPath(value: unknown, path: string): unknown {
  const segments = path.split(".").map((segment) => segment.trim()).filter(Boolean);
  let current = value;
  for (const segment of segments) {
    if (current === undefined || current === null) {
      return undefined;
    }
    if (/^\d+$/.test(segment) && Array.isArray(current)) {
      current = current[Number(segment)];
      continue;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
