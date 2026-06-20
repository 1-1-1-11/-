import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";

import { fetch } from "undici";

import type { CoffeePriceConfig, ExternalSourceConfig } from "./types.js";

export type MeituanDoctorStatus = "pass" | "warn" | "fail";

export interface MeituanDoctorCheck {
  id: string;
  label: string;
  status: MeituanDoctorStatus;
  message: string;
  detail?: string;
}

export interface MeituanDoctorReport {
  status: MeituanDoctorStatus;
  checks: MeituanDoctorCheck[];
}

export interface MeituanDoctorOptions {
  configPath: string;
  baseUrl: string;
  adbPath?: string;
  json: boolean;
}

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

export interface MeituanDoctorDeps {
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  execFile?: (file: string, args: string[], options?: ExecFileOptions) => Promise<ExecFileResult>;
  fetch?: typeof fetch;
}

interface ExecFileOptions {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";
const DEFAULT_BASE_URL = "http://127.0.0.1:18080";
const execFileAsync = promisify(execFileCallback);

export function parseMeituanDoctorArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): MeituanDoctorOptions {
  const options: MeituanDoctorOptions = {
    configPath: DEFAULT_CONFIG_PATH,
    baseUrl: env.MEITUAN_APP_BASE_URL ?? DEFAULT_BASE_URL,
    adbPath: env.MEITUAN_ADB_PATH,
    json: args.includes("--json")
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--config") {
      options.configPath = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--base-url") {
      options.baseUrl = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--adb") {
      options.adbPath = requireValue(arg, next);
      index += 1;
    }
  }

  return options;
}

export async function runMeituanDoctorCli(
  args: string[],
  deps: MeituanDoctorDeps = {}
): Promise<{ text: string; exitCode: number; report: MeituanDoctorReport }> {
  const options = parseMeituanDoctorArgs(args, deps.env);
  const report = await runMeituanDoctor(options, deps);
  return {
    text: options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatMeituanDoctorReport(report)}\n`,
    exitCode: report.status === "fail" ? 1 : 0,
    report
  };
}

export async function runMeituanDoctor(
  options: MeituanDoctorOptions,
  deps: MeituanDoctorDeps = {}
): Promise<MeituanDoctorReport> {
  const env = deps.env ?? process.env;
  const adb = await checkAdb(options, deps, env);
  const checks: MeituanDoctorCheck[] = [adb.check];

  checks.push(adb.path
    ? await checkAndroidDevice(adb.path, deps, env)
    : fail(
        "android-device",
        "Android 设备",
        "无法检查设备，因为 ADB 不可用",
        "先安装 Android SDK Platform-Tools，或用 --adb 指向 adb.exe"
      ));
  checks.push(await checkHttpService(options.baseUrl, deps));
  checks.push(await checkExternalSource(options.configPath, deps));

  return report(checks);
}

export function formatMeituanDoctorReport(report: MeituanDoctorReport): string {
  const lines = [`美团 App 自动化源检查`, `总体: ${report.status.toUpperCase()}`];
  for (const check of report.checks) {
    lines.push(`- [${check.status.toUpperCase()}] ${check.label}: ${check.message}`);
    if (check.detail) {
      lines.push(`  ${check.detail}`);
    }
  }
  return lines.join("\n");
}

async function checkAdb(
  options: MeituanDoctorOptions,
  deps: MeituanDoctorDeps,
  env: NodeJS.ProcessEnv
): Promise<{ path?: string; check: MeituanDoctorCheck }> {
  const execFile = deps.execFile ?? execFileText;
  const errors: string[] = [];
  for (const candidate of getAdbCandidates(options, env)) {
    try {
      const result = await execFile(candidate, ["version"], { timeout: 5_000, env });
      const version = result.stdout.split(/\r?\n/).find((line) => line.trim())?.trim();
      return {
        path: candidate,
        check: pass("adb", "ADB", version ?? "adb 可执行")
      };
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    check: fail(
      "adb",
      "ADB",
      "未找到可用的 adb",
      [
        "可运行: winget install --id Google.PlatformTools -e --accept-source-agreements --accept-package-agreements",
        "或设置 MEITUAN_ADB_PATH / --adb 指向 adb.exe",
        ...errors.slice(0, 3)
      ].join("\n")
    )
  };
}

function getAdbCandidates(options: MeituanDoctorOptions, env: NodeJS.ProcessEnv): string[] {
  const candidates = [
    options.adbPath,
    env.MEITUAN_ADB_PATH,
    platformToolsCandidate(env.ANDROID_HOME),
    platformToolsCandidate(env.ANDROID_SDK_ROOT),
    wingetPlatformToolsCandidate(env),
    "adb"
  ].filter((candidate): candidate is string => Boolean(candidate));
  return [...new Set(candidates)];
}

function platformToolsCandidate(root: string | undefined): string | undefined {
  return root ? join(root, "platform-tools", executableName("adb")) : undefined;
}

function wingetPlatformToolsCandidate(env: NodeJS.ProcessEnv): string | undefined {
  if (!env.LOCALAPPDATA) {
    return undefined;
  }
  return join(
    env.LOCALAPPDATA,
    "Microsoft",
    "WinGet",
    "Packages",
    "Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "platform-tools",
    executableName("adb")
  );
}

function executableName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

async function checkAndroidDevice(
  adbPath: string,
  deps: MeituanDoctorDeps,
  env: NodeJS.ProcessEnv
): Promise<MeituanDoctorCheck> {
  const execFile = deps.execFile ?? execFileText;
  try {
    const result = await execFile(adbPath, ["devices", "-l"], {
      timeout: 10_000,
      env: withAdbPath(env, adbPath)
    });
    const devices = parseAdbDevices(result.stdout);
    const ready = devices.filter((device) => device.status === "device");
    if (ready.length) {
      return pass(
        "android-device",
        "Android 设备",
        `${ready.length} 台设备已授权`,
        ready.map((device) => `${device.serial} ${device.detail}`.trim()).join("\n")
      );
    }
    if (devices.length) {
      return fail(
        "android-device",
        "Android 设备",
        "已发现设备但未处于可用授权状态",
        devices.map((device) => `${device.serial}: ${device.status} ${device.detail}`.trim()).join("\n")
      );
    }
    return fail(
      "android-device",
      "Android 设备",
      "未检测到已连接的 Android 设备",
      "请连接已安装并登录美团 App 的手机/模拟器，开启 USB 调试，保持解锁亮屏"
    );
  } catch (error) {
    return fail("android-device", "Android 设备", "adb devices 执行失败", errorMessage(error));
  }
}

function withAdbPath(env: NodeJS.ProcessEnv, adbPath: string): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: `${dirname(adbPath)}${delimiter}${env.PATH ?? ""}`,
    Path: `${dirname(adbPath)}${delimiter}${env.Path ?? env.PATH ?? ""}`
  };
}

function parseAdbDevices(output: string): Array<{ serial: string; status: string; detail: string }> {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.toLowerCase().startsWith("list of devices"))
    .map((line) => {
      const [serial = "", status = "", ...detail] = line.split(/\s+/);
      return { serial, status, detail: detail.join(" ") };
    })
    .filter((device) => device.serial && device.status);
}

async function checkHttpService(baseUrl: string, deps: MeituanDoctorDeps): Promise<MeituanDoctorCheck> {
  const fetchImpl = deps.fetch ?? fetch;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5_000);
  try {
    const url = new URL("/state", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const response = await fetchImpl(url, { signal: abort.signal });
    const text = await response.text();
    if (!response.ok) {
      return fail("service", "meituan-cli HTTP", `HTTP ${response.status}`, text.slice(0, 300));
    }
    const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
    if (payload.ok === false) {
      return fail("service", "meituan-cli HTTP", "服务在线但 App 控制不可用", String(payload.error ?? payload.suggestion ?? text));
    }
    return pass("service", "meituan-cli HTTP", `${baseUrl} 已响应 /state`);
  } catch (error) {
    return fail(
      "service",
      "meituan-cli HTTP",
      "未检测到 meituan-cli HTTP 服务",
      [
        `启动命令: .runtime\\meituan-cli\\.venv\\Scripts\\python.exe .runtime\\meituan-cli\\cli.py serve --port ${new URL(baseUrl).port || "18080"}`,
        errorMessage(error)
      ].join("\n")
    );
  } finally {
    clearTimeout(timer);
  }
}

async function checkExternalSource(configPath: string, deps: MeituanDoctorDeps): Promise<MeituanDoctorCheck> {
  try {
    const raw = JSON.parse(stripJsonBom(await (deps.readFile ?? readFile)(configPath, "utf8"))) as Partial<CoffeePriceConfig>;
    const source = raw.externalSources?.find((entry) => entry.id === "meituanApp");
    return checkMeituanSource(source);
  } catch (error) {
    return warn("external-source", "externalSources.meituanApp", "无法读取配置文件", errorMessage(error));
  }
}

function checkMeituanSource(source: ExternalSourceConfig | undefined): MeituanDoctorCheck {
  if (!source) {
    return warn(
      "external-source",
      "externalSources.meituanApp",
      "配置里缺少 meituanApp 外部源",
      "可从 config/coffee-price.config.example.json 复制 meituanApp 示例块"
    );
  }
  if (source.enabled === false) {
    return warn(
      "external-source",
      "externalSources.meituanApp",
      "meituanApp 已配置但未启用",
      "确认 Android 服务可用后，把 enabled 改为 true，再运行 npm run pricebook:refresh"
    );
  }
  return pass("external-source", "externalSources.meituanApp", "meituanApp 已启用");
}

async function execFileText(file: string, args: string[], options: ExecFileOptions = {}): Promise<ExecFileResult> {
  const result = await execFileAsync(file, args, {
    timeout: options.timeout,
    env: options.env,
    encoding: "utf8"
  });
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr)
  };
}

function stripJsonBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} 缺少参数值`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function report(checks: MeituanDoctorCheck[]): MeituanDoctorReport {
  return {
    status: summarize(checks),
    checks
  };
}

function summarize(checks: MeituanDoctorCheck[]): MeituanDoctorStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

function pass(id: string, label: string, message: string, detail?: string): MeituanDoctorCheck {
  return { id, label, status: "pass", message, detail };
}

function warn(id: string, label: string, message: string, detail?: string): MeituanDoctorCheck {
  return { id, label, status: "warn", message, detail };
}

function fail(id: string, label: string, message: string, detail?: string): MeituanDoctorCheck {
  return { id, label, status: "fail", message, detail };
}
