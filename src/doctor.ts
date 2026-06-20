import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  message: string;
  detail?: string;
}

export interface DoctorReport {
  status: DoctorStatus;
  checks: DoctorCheck[];
}

export interface DoctorFacts {
  openclawConfig?: {
    coffeeConfigPath?: string;
    meituanSnapshotPath?: string;
    dmScope?: string;
    weixinEnabled?: boolean;
  };
  pathExists: Record<string, boolean>;
  gatewayStatusText?: string;
  gatewayWrapperText?: string;
  weixinCapabilitiesText?: string;
  ilinkProbe?: {
    ok: boolean;
    status?: number;
    error?: string;
    code?: string;
  };
}

export interface CommandInvocation {
  file: string;
  args: string[];
}

interface OpenClawJson {
  plugins?: {
    entries?: {
      "coffee-price"?: {
        config?: {
          configPath?: string;
          snapshotPaths?: {
            meituan?: string;
          };
        };
      };
      "openclaw-weixin"?: {
        enabled?: boolean;
      };
    };
  };
  session?: {
    dmScope?: string;
  };
}

export function buildDoctorReport(facts: DoctorFacts): DoctorReport {
  const checks = [
    checkGateway(facts.gatewayStatusText),
    checkGatewayPreload(facts.gatewayWrapperText),
    checkCoffeeConfigPath(facts),
    checkMeituanSnapshotPath(facts),
    checkWeixinPlugin(facts),
    checkWeixinLogin(facts.weixinCapabilitiesText),
    checkDmScope(facts),
    checkIlinkTls(facts.ilinkProbe)
  ];
  return {
    status: summarizeStatus(checks),
    checks
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [`OpenClaw 咖啡助手诊断`, `总体: ${report.status.toUpperCase()}`];
  for (const check of report.checks) {
    lines.push(`- [${check.status.toUpperCase()}] ${check.label}: ${check.message}`);
    if (check.detail) {
      lines.push(`  ${check.detail}`);
    }
  }
  return lines.join("\n");
}

export async function collectDoctorFacts(): Promise<DoctorFacts> {
  const openclawConfig = await readOpenClawConfig();
  const coffeeConfigPath = openclawConfig.plugins?.entries?.["coffee-price"]?.config?.configPath;
  const meituanSnapshotPath =
    openclawConfig.plugins?.entries?.["coffee-price"]?.config?.snapshotPaths?.meituan;
  const paths = [coffeeConfigPath, meituanSnapshotPath].filter((value): value is string =>
    Boolean(value)
  );

  const [gatewayStatus, gatewayWrapperText, weixinCapabilities, ilinkProbe, pathExists] = await Promise.all([
    runOpenClaw(["gateway", "status"]),
    readGatewayWrapper(),
    runOpenClaw(["channels", "capabilities", "--channel", "openclaw-weixin"]),
    probeIlinkTls(),
    checkPaths(paths)
  ]);

  return {
    openclawConfig: {
      coffeeConfigPath,
      meituanSnapshotPath,
      dmScope: openclawConfig.session?.dmScope,
      weixinEnabled: openclawConfig.plugins?.entries?.["openclaw-weixin"]?.enabled === true
    },
    pathExists,
    gatewayStatusText: gatewayStatus.stdout + gatewayStatus.stderr,
    gatewayWrapperText,
    weixinCapabilitiesText: weixinCapabilities.stdout + weixinCapabilities.stderr,
    ilinkProbe
  };
}

export async function runDoctor(): Promise<DoctorReport> {
  return buildDoctorReport(await collectDoctorFacts());
}

export function getOpenClawInvocation(
  cwd: string,
  _platform: NodeJS.Platform,
  args: string[]
): CommandInvocation {
  return {
    file: process.execPath,
    args: [join(cwd, "node_modules", "openclaw", "openclaw.mjs"), ...args]
  };
}

function checkGateway(text: string | undefined): DoctorCheck {
  if (!text) {
    return fail("gateway", "OpenClaw Gateway", "没有拿到 Gateway 状态输出");
  }
  if (/Connectivity probe:\s*ok/i.test(text) && /Listening:\s*127\.0\.0\.1:18789/i.test(text)) {
    return pass("gateway", "OpenClaw Gateway", "运行中，127.0.0.1:18789 可连接");
  }
  return fail("gateway", "OpenClaw Gateway", "Gateway 未通过连接探测", compact(text));
}

function checkGatewayPreload(text: string | undefined): DoctorCheck {
  if (!text) {
    return fail("gateway-preload", "Gateway iLink DNS preload", "没有读取到 OpenClaw Gateway wrapper");
  }
  if (/openclaw-network-preload\.mjs/i.test(text) && /NODE_OPTIONS/i.test(text)) {
    return pass("gateway-preload", "Gateway iLink DNS preload", "Gateway 会加载 iLink DNS 修正 preload");
  }
  return fail(
    "gateway-preload",
    "Gateway iLink DNS preload",
    "Gateway wrapper 未加载 iLink DNS 修正 preload",
    "重新运行 .\\scripts\\install-openclaw-wechat.ps1"
  );
}

function checkCoffeeConfigPath(facts: DoctorFacts): DoctorCheck {
  const path = facts.openclawConfig?.coffeeConfigPath;
  if (!path) {
    return fail("coffee-config-path", "coffee-price 配置路径", "OpenClaw config 未设置 coffee-price configPath");
  }
  if (hasMojibake(path)) {
    return fail("coffee-config-path", "coffee-price 配置路径", "路径包含中文乱码，需要改用 ASCII junction 路径", path);
  }
  if (!isAsciiJunctionPath(path)) {
    return warn("coffee-config-path", "coffee-price 配置路径", "路径不是推荐的 ASCII junction 路径", path);
  }
  if (!facts.pathExists[path]) {
    return fail("coffee-config-path", "coffee-price 配置路径", "配置文件不存在", path);
  }
  return pass("coffee-config-path", "coffee-price 配置路径", "配置文件路径有效", path);
}

function checkMeituanSnapshotPath(facts: DoctorFacts): DoctorCheck {
  const path = facts.openclawConfig?.meituanSnapshotPath;
  if (!path) {
    return warn("meituan-snapshot-path", "美团 snapshot 路径", "未配置美团 snapshot；真实浏览器提取可不依赖它");
  }
  if (hasMojibake(path)) {
    return fail("meituan-snapshot-path", "美团 snapshot 路径", "路径包含中文乱码，需要改用 ASCII junction 路径", path);
  }
  if (!facts.pathExists[path]) {
    return warn("meituan-snapshot-path", "美团 snapshot 路径", "snapshot 文件不存在；如果使用真实浏览器提取可忽略", path);
  }
  return pass("meituan-snapshot-path", "美团 snapshot 路径", "snapshot 路径有效", path);
}

function checkWeixinPlugin(facts: DoctorFacts): DoctorCheck {
  if (facts.openclawConfig?.weixinEnabled) {
    return pass("weixin-plugin", "微信插件开关", "openclaw-weixin 插件已启用");
  }
  return fail("weixin-plugin", "微信插件开关", "openclaw-weixin 插件未启用");
}

function checkWeixinLogin(text: string | undefined): DoctorCheck {
  if (!text) {
    return fail("weixin-login", "微信扫码登录", "没有拿到微信 channel 能力输出");
  }
  if (/Status:\s*not configured/i.test(text)) {
    return fail(
      "weixin-login",
      "微信扫码登录",
      "微信 channel 尚未完成扫码登录",
      "运行 openclaw channels login --channel openclaw-weixin；如果 Windows PowerShell 5.1 未显示二维码，运行 npm run weixin:login"
    );
  }
  if (/Status:\s*configured/i.test(text) || /Status:.*enabled/i.test(text)) {
    return pass("weixin-login", "微信扫码登录", "微信 channel 已配置");
  }
  return warn("weixin-login", "微信扫码登录", "无法从能力输出判断登录状态", compact(text));
}

function checkDmScope(facts: DoctorFacts): DoctorCheck {
  if (facts.openclawConfig?.dmScope === "per-account-channel-peer") {
    return pass("dm-scope", "微信私聊会话隔离", "已按账号 + 渠道 + 对端隔离");
  }
  return warn("dm-scope", "微信私聊会话隔离", "建议设置 session.dmScope=per-account-channel-peer");
}

function checkIlinkTls(probe: DoctorFacts["ilinkProbe"]): DoctorCheck {
  if (!probe) {
    return fail("ilink-tls", "微信 iLink HTTPS", "没有执行 iLink HTTPS 探测");
  }
  if (probe.ok) {
    return pass("ilink-tls", "微信 iLink HTTPS", `TLS/HTTPS 可达${probe.status ? `，HTTP ${probe.status}` : ""}`);
  }
  const prefix = probe.code ? `${probe.code}: ` : "";
  return fail("ilink-tls", "微信 iLink HTTPS", `${prefix}${probe.error ?? "HTTPS 探测失败"}`);
}

function summarizeStatus(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

function pass(id: string, label: string, message: string, detail?: string): DoctorCheck {
  return { id, label, status: "pass", message, detail };
}

function warn(id: string, label: string, message: string, detail?: string): DoctorCheck {
  return { id, label, status: "warn", message, detail };
}

function fail(id: string, label: string, message: string, detail?: string): DoctorCheck {
  return { id, label, status: "fail", message, detail };
}

function hasMojibake(value: string): boolean {
  return /�|锟|鑷|姩|鏌|鐧|骞|閰|璐/.test(value);
}

function isAsciiJunctionPath(value: string): boolean {
  return /[\\/]\.openclaw[\\/]coffee-price-project[\\/]/i.test(value);
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

async function readOpenClawConfig(): Promise<OpenClawJson> {
  const content = await readFile(join(homedir(), ".openclaw", "openclaw.json"), "utf8");
  return JSON.parse(stripJsonBom(content)) as OpenClawJson;
}

function stripJsonBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

async function checkPaths(paths: string[]): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    paths.map(async (path) => {
      try {
        await access(path);
        return [path, true] as const;
      } catch {
        return [path, false] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

async function probeIlinkTls(): Promise<NonNullable<DoctorFacts["ilinkProbe"]>> {
  const preloadUrl = pathToFileURL(join(process.cwd(), "scripts", "openclaw-network-preload.mjs")).href;
  const script = [
    "fetch('https://ilinkai.weixin.qq.com')",
    ".then((response)=>{ console.log('ILINK_STATUS ' + response.status); })",
    ".catch((error)=>{",
    "const cause = error && error.cause;",
    "console.log('ILINK_ERROR ' + (cause && cause.code ? cause.code + ': ' : '') + (cause && cause.message ? cause.message : error.message));",
    "process.exitCode = 1;",
    "})"
  ].join("");
  const result = await runProcess(process.execPath, ["--import", preloadUrl, "-e", script], 15_000);
  const output = `${result.stdout}${result.stderr}`.trim();
  const statusMatch = output.match(/ILINK_STATUS\s+(\d+)/);
  if (result.exitCode === 0 && statusMatch?.[1]) {
    return { ok: true, status: Number.parseInt(statusMatch[1], 10) };
  }
  const errorText = output.match(/ILINK_ERROR\s+(.+)/)?.[1] ?? (output || "iLink probe failed");
  const codeMatch = errorText.match(/^([A-Z0-9_]+):\s+(.+)$/);
  return {
    ok: false,
    code: codeMatch?.[1],
    error: codeMatch?.[2] ?? errorText
  };
}

async function readGatewayWrapper(): Promise<string | undefined> {
  try {
    return await readFile(join(homedir(), ".openclaw", "gateway.cmd"), "utf8");
  } catch {
    return undefined;
  }
}

function runOpenClaw(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const invocation = getOpenClawInvocation(process.cwd(), process.platform, args);
  return new Promise((resolve) => {
    const child = spawn(invocation.file, invocation.args, {
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", async () => {
      const fallback = await runNpxOpenClaw(args);
      resolve(fallback);
    });
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });
}

function runProcess(
  file: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr: `${stderr}${error.message}`, exitCode: 1 });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode });
    });
  });
}

function runNpxOpenClaw(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  return new Promise((resolve) => {
    const child = spawn(command, ["openclaw", ...args], {
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ stdout, stderr: `${stderr}${error.message}`, exitCode: 1 });
    });
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });
}
