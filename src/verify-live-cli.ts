import { readFile } from "node:fs/promises";

import { readConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import {
  buildLiveReadinessReport,
  defaultAuditPath,
  defaultNetworkPath,
  formatLiveReadinessReport
} from "./live-readiness.js";
import type { BrowserNetworkLogEntry } from "./browser-capture.js";
import type { CaptureCalibrationReport } from "./capture-calibrate.js";
import type { DoctorReport } from "./doctor.js";
import type { BrowserSourceSelectorAudit } from "./providers/browser-source-provider.js";
import type { CoffeePriceConfig, SourceConfig } from "./types.js";

export interface VerifyLiveCliOptions {
  configPath: string;
  auditPaths: Record<keyof SourceConfig, string>;
  networkPaths: Record<keyof SourceConfig, string>;
  calibrationReportPath: string;
  ignoreCalibrationReport: boolean;
  outputFormat: "text" | "json";
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
  readNetworkLog?: (path: string) => Promise<BrowserNetworkLogEntry[] | null>;
  readCalibrationReport?: (path: string) => Promise<CaptureCalibrationReport | null>;
}

const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";
const DEFAULT_CALIBRATION_REPORT_PATH = ".runtime/captures/calibration-report.json";
const SOURCE_KEYS = ["meituan", "eleme", "brandOfficial"] as const;

export function parseVerifyLiveCliArgs(args: string[]): VerifyLiveCliOptions {
  return {
    configPath: readOption(args, "--config") ?? DEFAULT_CONFIG_PATH,
    auditPaths: {
      meituan: readOption(args, "--audit-meituan") ?? defaultAuditPath("meituan"),
      eleme: readOption(args, "--audit-eleme") ?? defaultAuditPath("eleme"),
      brandOfficial: readOption(args, "--audit-brand") ?? defaultAuditPath("brandOfficial")
    },
    networkPaths: {
      meituan: readOption(args, "--network-meituan") ?? defaultNetworkPath("meituan"),
      eleme: readOption(args, "--network-eleme") ?? defaultNetworkPath("eleme"),
      brandOfficial: readOption(args, "--network-brand") ?? defaultNetworkPath("brandOfficial")
    },
    calibrationReportPath: readOption(args, "--calibration-report") ?? DEFAULT_CALIBRATION_REPORT_PATH,
    ignoreCalibrationReport: args.includes("--ignore-calibration-report"),
    outputFormat: args.includes("--json") ? "json" : "text",
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
  const readNetworkLog = deps.readNetworkLog ?? readNetworkLogFile;
  const audits: Partial<Record<keyof SourceConfig, BrowserSourceSelectorAudit | null>> = {};
  const networkLogs: Partial<Record<keyof SourceConfig, BrowserNetworkLogEntry[] | null>> = {};

  for (const source of SOURCE_KEYS) {
    audits[source] = await readAudit(options.auditPaths[source]);
    networkLogs[source] = await readNetworkLog(options.networkPaths[source]);
  }

  const calibrationReport = options.ignoreCalibrationReport
    ? null
    : await (deps.readCalibrationReport ?? readCalibrationReportFile)(options.calibrationReportPath);
  const report = buildLiveReadinessReport({ config, doctor, audits, networkLogs, calibrationReport });
  return {
    text: options.outputFormat === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatLiveReadinessReport(report),
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

async function readNetworkLogFile(path: string): Promise<BrowserNetworkLogEntry[] | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as BrowserNetworkLogEntry[];
  } catch {
    return null;
  }
}

async function readCalibrationReportFile(path: string): Promise<CaptureCalibrationReport | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as CaptureCalibrationReport;
  } catch {
    return null;
  }
}
