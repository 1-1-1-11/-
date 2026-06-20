import { readFile } from "node:fs/promises";

import { readConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import {
  buildLiveReadinessReport,
  defaultAuditPath,
  formatLiveReadinessReport
} from "./live-readiness.js";
import type { DoctorReport } from "./doctor.js";
import type { BrowserSourceSelectorAudit } from "./providers/browser-source-provider.js";
import type { CoffeePriceConfig, SourceConfig } from "./types.js";

export interface VerifyLiveCliOptions {
  configPath: string;
  auditPaths: Record<keyof SourceConfig, string>;
  skipDoctor: boolean;
}

export interface VerifyLiveCliResult {
  text: string;
  exitCode: number;
  report: ReturnType<typeof buildLiveReadinessReport>;
}

export interface VerifyLiveCliDeps {
  readConfig?: (path: string) => Promise<CoffeePriceConfig>;
  runDoctor?: () => Promise<DoctorReport>;
  readAudit?: (path: string) => Promise<BrowserSourceSelectorAudit | null>;
}

const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";
const SOURCE_KEYS = ["meituan", "eleme", "brandOfficial"] as const;

export function parseVerifyLiveCliArgs(args: string[]): VerifyLiveCliOptions {
  return {
    configPath: readOption(args, "--config") ?? DEFAULT_CONFIG_PATH,
    auditPaths: {
      meituan: readOption(args, "--audit-meituan") ?? defaultAuditPath("meituan"),
      eleme: readOption(args, "--audit-eleme") ?? defaultAuditPath("eleme"),
      brandOfficial: readOption(args, "--audit-brand") ?? defaultAuditPath("brandOfficial")
    },
    skipDoctor: args.includes("--skip-doctor")
  };
}

export async function runVerifyLiveCli(
  args: string[],
  deps: VerifyLiveCliDeps = {}
): Promise<VerifyLiveCliResult> {
  const options = parseVerifyLiveCliArgs(args);
  const config = await (deps.readConfig ?? readConfig)(options.configPath);
  const doctor = options.skipDoctor ? undefined : await (deps.runDoctor ?? runDoctor)();
  const readAudit = deps.readAudit ?? readAuditFile;
  const audits: Partial<Record<keyof SourceConfig, BrowserSourceSelectorAudit | null>> = {};

  for (const source of SOURCE_KEYS) {
    audits[source] = await readAudit(options.auditPaths[source]);
  }

  const report = buildLiveReadinessReport({ config, doctor, audits });
  return {
    text: formatLiveReadinessReport(report),
    exitCode: report.status === "fail" ? 1 : 0,
    report
  };
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

async function readAuditFile(path: string): Promise<BrowserSourceSelectorAudit | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as BrowserSourceSelectorAudit;
  } catch {
    return null;
  }
}
