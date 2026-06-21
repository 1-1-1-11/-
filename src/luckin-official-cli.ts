import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import { enableLuckinMcp, type LuckinEnableResult } from "./luckin-mcp-enable.js";
import { formatLuckinDoctorReport, runLuckinDoctor, type LuckinDoctorReport } from "./luckin-mcp-doctor.js";
import { importLuckinToken, type LuckinTokenImportResult } from "./luckin-token-import.js";

export interface LuckinOfficialCliOptions {
  manifestUrl: string;
  installDir: string;
  configPath: string;
  tokenText?: string;
  tokenPath?: string;
  fromClipboard?: boolean;
  loginTimeoutMs?: number;
  installOnly: boolean;
  runLogin: boolean;
  enable: boolean;
  json: boolean;
}

export interface LuckinOfficialCliManifest {
  latest: string;
  files: LuckinOfficialCliManifestFile[];
}

export interface LuckinOfficialCliManifestFile {
  os: string;
  arch: string;
  url: string;
  sha256?: string;
}

export interface LuckinOfficialCliInstallResult {
  executablePath: string;
  version: string;
  archivePath: string;
  downloaded: boolean;
}

export interface LuckinOfficialCliResult {
  install: LuckinOfficialCliInstallResult;
  loginExitCode?: number;
  tokenImport?: LuckinTokenImportResult;
  enable?: LuckinEnableResult;
  doctor?: LuckinDoctorReport;
  text: string;
}

export interface LuckinOfficialCliDeps {
  env?: NodeJS.ProcessEnv;
  fetchText?: (url: string) => Promise<string>;
  fetchBuffer?: (url: string) => Promise<Buffer>;
  mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  writeFile?: (path: string, content: Buffer | string) => Promise<void>;
  readFile?: (path: string) => Promise<Buffer>;
  existsSync?: (path: string) => boolean;
  extractArchive?: (archivePath: string, destinationPath: string, kind: "zip" | "tgz") => Promise<void>;
  runCommand?: (command: string, args: string[]) => Promise<number>;
  importLuckinToken?: typeof importLuckinToken;
  enableLuckinMcp?: typeof enableLuckinMcp;
  runLuckinDoctor?: typeof runLuckinDoctor;
  platform?: NodeJS.Platform;
  arch?: string;
  cwd?: string;
}

const DEFAULT_MANIFEST_URL = "https://open.lkcoffee.com/cli/manifest.json";
const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";
const DEFAULT_INSTALL_DIR = join(".runtime", "luckin-official-cli");
const DEFAULT_TOKEN_PATH = join(homedir(), ".my-coffee", "LUCKIN_MCP_TOKEN");
const DEFAULT_LOGIN_TIMEOUT_MS = 180_000;

export function parseLuckinOfficialCliArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): LuckinOfficialCliOptions {
  const options: LuckinOfficialCliOptions = {
    manifestUrl: env.LUCKIN_MANIFEST_URL ?? DEFAULT_MANIFEST_URL,
    installDir: env.LUCKIN_CLI_INSTALL_DIR ?? DEFAULT_INSTALL_DIR,
    configPath: DEFAULT_CONFIG_PATH,
    tokenPath: env.LUCKIN_MCP_TOKEN_FILE ?? DEFAULT_TOKEN_PATH,
    fromClipboard: args.includes("--from-clipboard"),
    loginTimeoutMs: parseOptionalInteger(env.LUCKIN_OFFICIAL_LOGIN_TIMEOUT_MS) ?? DEFAULT_LOGIN_TIMEOUT_MS,
    installOnly: args.includes("--install-only"),
    runLogin: !args.includes("--skip-login") && !args.includes("--install-only"),
    enable: !args.includes("--no-enable") && !args.includes("--install-only"),
    json: args.includes("--json")
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--":
      case "--skip-login":
      case "--no-enable":
      case "--install-only":
      case "--json":
      case "--from-clipboard":
        break;
      case "--manifest-url":
        options.manifestUrl = requireValue(arg, next);
        index += 1;
        break;
      case "--install-dir":
        options.installDir = requireValue(arg, next);
        index += 1;
        break;
      case "--config":
        options.configPath = requireValue(arg, next);
        index += 1;
        break;
      case "--token":
        options.tokenText = requireValue(arg, next);
        index += 1;
        break;
      case "--token-file":
        options.tokenPath = requireValue(arg, next);
        index += 1;
        break;
      case "--login-timeout-ms":
        options.loginTimeoutMs = parseRequiredInteger(arg, next);
        index += 1;
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }

  return options;
}

export async function runLuckinOfficialCli(
  args: string[],
  deps: LuckinOfficialCliDeps = {}
): Promise<{ text: string; exitCode: number; result?: LuckinOfficialCliResult }> {
  const options = parseLuckinOfficialCliArgs(args, deps.env);
  try {
    const result = await setupLuckinOfficialCli(options, deps);
    const exitCode =
      (result.loginExitCode !== undefined && result.loginExitCode !== 0) || result.doctor?.status === "fail"
        ? 1
        : 0;
    return {
      text: options.json ? `${JSON.stringify(toJsonResult(result), null, 2)}\n` : `${result.text}\n`,
      exitCode,
      result
    };
  } catch (error) {
    return {
      text: `瑞幸官方 CLI 设置失败: ${error instanceof Error ? error.message : String(error)}\n`,
      exitCode: 1
    };
  }
}

export async function setupLuckinOfficialCli(
  options: LuckinOfficialCliOptions,
  deps: LuckinOfficialCliDeps = {}
): Promise<LuckinOfficialCliResult> {
  const install = await ensureLuckinOfficialCli(options, deps);
  let loginExitCode: number | undefined;
  let tokenImport: LuckinTokenImportResult | undefined;
  if (options.tokenText || options.fromClipboard) {
    tokenImport = await (deps.importLuckinToken ?? importLuckinToken)(
      {
        tokenText: options.tokenText,
        tokenPath: options.tokenPath ?? DEFAULT_TOKEN_PATH,
        configPath: options.configPath,
        enable: options.enable,
        fromClipboard: options.fromClipboard
      },
      {}
    );
  } else if (options.runLogin) {
    loginExitCode = deps.runCommand
      ? await deps.runCommand(install.executablePath, ["login"])
      : await runCommand(install.executablePath, ["login"], options.loginTimeoutMs);
    if (loginExitCode !== 0) {
      return {
        install,
        loginExitCode,
        text: formatOfficialCliResult({ install, loginExitCode })
      };
    }
  }
  if (options.installOnly) {
    return {
      install,
      text: formatOfficialCliResult({ install })
    };
  }

  const enable = options.enable
    ? tokenImport
      ? undefined
      : await (deps.enableLuckinMcp ?? enableLuckinMcp)({
          configPath: options.configPath,
          dryRun: false
        })
    : undefined;
  const doctor = await (deps.runLuckinDoctor ?? runLuckinDoctor)({
    configPath: options.configPath,
    json: false
  });

  return {
    install,
    loginExitCode,
    tokenImport,
    enable,
    doctor,
    text: formatOfficialCliResult({ install, loginExitCode, tokenImport, enable, doctor })
  };
}

export async function ensureLuckinOfficialCli(
  options: Pick<LuckinOfficialCliOptions, "manifestUrl" | "installDir">,
  deps: LuckinOfficialCliDeps = {}
): Promise<LuckinOfficialCliInstallResult> {
  const manifest = JSON.parse(await (deps.fetchText ?? fetchText)(options.manifestUrl)) as LuckinOfficialCliManifest;
  const selected = selectLuckinCliManifestFile(manifest, deps.platform ?? process.platform, deps.arch ?? process.arch);
  const root = resolve(deps.cwd ?? process.cwd(), options.installDir);
  const archiveDir = join(root, "downloads");
  const extractDir = join(root, "extract");
  await (deps.mkdir ?? mkdir)(archiveDir, { recursive: true });
  await (deps.mkdir ?? mkdir)(extractDir, { recursive: true });

  const archivePath = join(archiveDir, basename(new URL(selected.url).pathname) || "luckin-cli.zip");
  let downloaded = false;
  if (!(deps.existsSync ?? existsSync)(archivePath)) {
    const body = await (deps.fetchBuffer ?? fetchBuffer)(selected.url);
    verifySha256(body, selected.sha256);
    await (deps.writeFile ?? writeFile)(archivePath, body);
    downloaded = true;
  } else if (selected.sha256) {
    verifySha256(await (deps.readFile ?? readFile)(archivePath), selected.sha256);
  }

  await (deps.extractArchive ?? extractArchive)(archivePath, extractDir, selected.url.endsWith(".zip") ? "zip" : "tgz");
  const executablePath = join(extractDir, (deps.platform ?? process.platform) === "win32" ? "luckin.exe" : "luckin");
  if (!(deps.existsSync ?? existsSync)(executablePath)) {
    throw new Error(`官方 CLI 解压后未找到可执行文件: ${executablePath}`);
  }

  return {
    executablePath,
    version: manifest.latest,
    archivePath,
    downloaded
  };
}

export function selectLuckinCliManifestFile(
  manifest: LuckinOfficialCliManifest,
  platform: NodeJS.Platform,
  arch: string
): LuckinOfficialCliManifestFile {
  const os = normalizePlatform(platform);
  const normalizedArch = normalizeArch(arch);
  const selected = manifest.files.find((file) => file.os === os && file.arch === normalizedArch);
  if (!selected) {
    throw new Error(`瑞幸官方 CLI 暂不支持当前平台: ${os}/${normalizedArch}`);
  }
  return selected;
}

function normalizePlatform(platform: NodeJS.Platform): string {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "darwin";
  if (platform === "linux") return "linux";
  return platform;
}

function normalizeArch(arch: string): string {
  if (arch === "x64") return "amd64";
  if (arch === "arm64") return "arm64";
  return arch;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败 ${response.status}: ${url}`);
  }
  return response.text();
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败 ${response.status}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function verifySha256(body: Buffer, expected: string | undefined): void {
  if (!expected) {
    return;
  }
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`官方 CLI 校验失败: expected ${expected}, actual ${actual}`);
  }
}

function extractArchive(archivePath: string, destinationPath: string, kind: "zip" | "tgz"): Promise<void> {
  if (kind === "zip") {
    return runCommand("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "& { param($archive,$destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }",
      archivePath,
      destinationPath
    ]).then(assertZeroExit("Expand-Archive"));
  }
  return runCommand("tar", ["-xzf", archivePath, "-C", destinationPath]).then(assertZeroExit("tar"));
}

function assertZeroExit(label: string): (exitCode: number) => void {
  return (exitCode) => {
    if (exitCode !== 0) {
      throw new Error(`${label} 退出码 ${exitCode}`);
    }
  };
}

function runCommand(command: string, args: string[], timeoutMs?: number): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawn(command, args, {
      stdio: "inherit"
    });
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, timeoutMs)
      : undefined;
    child.once("error", () => {
      if (timer) clearTimeout(timer);
      resolveExit(1);
    });
    child.once("exit", (code) => {
      if (timer) clearTimeout(timer);
      resolveExit(timedOut ? 124 : code ?? 1);
    });
  });
}

function formatOfficialCliResult(input: {
  install: LuckinOfficialCliInstallResult;
  loginExitCode?: number;
  tokenImport?: LuckinTokenImportResult;
  enable?: LuckinEnableResult;
  doctor?: LuckinDoctorReport;
}): string {
  const lines = [
    `瑞幸官方 CLI: ${input.install.executablePath}`,
    `版本: ${input.install.version}`,
    input.install.downloaded ? "已下载并校验官方 CLI" : "已复用本机已下载的官方 CLI"
  ];
  if (input.loginExitCode !== undefined) {
    lines.push(`官方登录命令退出码: ${input.loginExitCode}`);
  }
  if (input.loginExitCode !== undefined && input.loginExitCode !== 0) {
    lines.push("登录未完成或超时；请重新运行 npm run luckin:official-login 并完成浏览器授权。");
    lines.push("也可以复制开放平台 token 后运行: npm run luckin:official-login -- --from-clipboard");
    return lines.join("\n");
  }
  if (input.tokenImport) {
    lines.push(`已导入瑞幸官方 token: ${input.tokenImport.tokenPath}`);
  }
  if (input.enable) {
    lines.push(input.enable.text);
  }
  if (input.doctor) {
    lines.push("", formatLuckinDoctorReport(input.doctor));
  }
  if (input.doctor?.status === "pass") {
    lines.push("", "瑞幸官方 CLI 已可用于实时自取价；只调用 order preview，不会调用 order create。");
  } else if (input.doctor) {
    lines.push("", "边界: 官方 CLI 已就绪，但 token 或 source 状态仍未完全通过，微信查价会继续使用兜底源。");
  }
  return lines.join("\n");
}

function toJsonResult(result: LuckinOfficialCliResult): Omit<LuckinOfficialCliResult, "text"> {
  return {
    install: result.install,
    loginExitCode: result.loginExitCode,
    tokenImport: result.tokenImport,
    enable: result.enable,
    doctor: result.doctor
  };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} 缺少参数值`);
  }
  return value;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRequiredInteger(flag: string, value: string | undefined): number {
  const parsed = parseOptionalInteger(requireValue(flag, value));
  if (parsed === undefined) {
    throw new Error(`${flag} 必须是整数`);
  }
  return parsed;
}
