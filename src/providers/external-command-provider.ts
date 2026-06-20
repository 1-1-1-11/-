import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
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
