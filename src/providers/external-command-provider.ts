import { spawn } from "node:child_process";

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
  const stdout = await spawnJsonCommand(source, request);
  const parsed = JSON.parse(stdout) as PlatformSnapshot;
  return {
    ...parsed,
    source: parsed.source || source.id
  };
}

function spawnJsonCommand(source: ExternalSourceConfig, request: ExternalPriceSourceRequest): Promise<string> {
  return new Promise((resolve, reject) => {
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
