import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

import {
  completeWeixinLogin,
  type CompleteWeixinLoginInput,
  type CompleteWeixinLoginResult
} from "./weixin-login.js";

export interface WeixinLoginCliOptions {
  timeoutMs: number;
  pollIntervalMs: number;
  qrUrlFile?: string;
  qrHtmlFile?: string;
  openQr: boolean;
}

export interface WeixinLoginCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface WeixinLoginCliDeps {
  completeWeixinLogin?: (input: CompleteWeixinLoginInput) => Promise<CompleteWeixinLoginResult>;
  writeQrUrlFile?: (path: string, content: string) => Promise<void>;
  writeQrHtmlFile?: (path: string, content: string) => Promise<void>;
  openUrl?: (url: string) => Promise<void>;
}

export function parseWeixinLoginCliArgs(args: string[]): WeixinLoginCliOptions {
  return {
    timeoutMs: readNumberOption(args, "--timeout-ms") ?? 480_000,
    pollIntervalMs: readNumberOption(args, "--poll-ms") ?? 1000,
    qrUrlFile: readStringOption(args, "--qr-url-file"),
    qrHtmlFile: readStringOption(args, "--qr-html-file"),
    openQr: args.includes("--open-qr")
  };
}

export async function runWeixinLoginCli(
  args: string[],
  deps: WeixinLoginCliDeps = {}
): Promise<WeixinLoginCliResult> {
  const options = parseWeixinLoginCliArgs(args);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const writeQrUrlFile = deps.writeQrUrlFile ?? writeQrUrlFileToDisk;
  const writeQrHtmlFile = deps.writeQrHtmlFile ?? writeQrHtmlFileToDisk;
  const openUrl = deps.openUrl ?? openUrlInDefaultBrowser;

  try {
    const result = await (deps.completeWeixinLogin ?? completeWeixinLogin)({
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      onQrCode: async (url) => {
        stdout.push("微信扫码链接:");
        stdout.push(url);
        stdout.push("请用手机微信扫描该链接生成的二维码，或把链接复制到浏览器后扫码。");
        if (options.qrUrlFile) {
          await writeQrUrlFile(options.qrUrlFile, `${url}\n`);
          stdout.push(`QR URL file: ${options.qrUrlFile}`);
        }
        if (options.qrHtmlFile) {
          await writeQrHtmlFile(options.qrHtmlFile, buildQrHtml(url));
          stdout.push(`QR HTML file: ${options.qrHtmlFile}`);
        }
        if (options.openQr) {
          try {
            await openUrl(url);
            stdout.push("Opened QR URL in default browser.");
          } catch (error) {
            stderr.push(`Failed to open QR URL: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      },
      onStatus: (status) => {
        if (status !== "wait") {
          stdout.push(`微信登录状态: ${status}`);
        }
      }
    });

    if (result.status === "connected") {
      stdout.push(`微信已连接: ${result.accountId}`);
      stdout.push("已更新 OpenClaw 微信 channel 配置刷新时间戳；如果 Gateway 仍未识别，请运行 npx openclaw gateway restart。");
      return buildResult(stdout, stderr, 0);
    }
    if (result.status === "already_connected") {
      stdout.push(result.message);
      return buildResult(stdout, stderr, 0);
    }

    stderr.push(result.message);
    return buildResult(stdout, stderr, 1);
  } catch (error) {
    stderr.push(error instanceof Error ? error.message : String(error));
    return buildResult(stdout, stderr, 1);
  }
}

function readNumberOption(args: string[], name: string): number | undefined {
  const value = readStringOption(args, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数毫秒`);
  }
  return parsed;
}

function readStringOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} 缺少参数值`);
  }
  return value;
}

async function writeQrUrlFileToDisk(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function writeQrHtmlFileToDisk(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function buildQrHtml(url: string): string {
  const escapedUrl = escapeHtml(url);
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8">',
    "  <title>OpenClaw 微信扫码登录</title>",
    "</head>",
    "<body>",
    "  <h1>OpenClaw 微信扫码登录</h1>",
    "  <p>请用手机微信打开或扫描此链接。</p>",
    `  <p><a href="${escapedUrl}" rel="noopener noreferrer">打开微信二维码链接</a></p>`,
    `  <p><code>${escapedUrl}</code></p>`,
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function openUrlInDefaultBrowser(url: string): Promise<void> {
  const invocation = getOpenUrlInvocation(url);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.file, invocation.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function getOpenUrlInvocation(url: string): { file: string; args: string[] } {
  if (process.platform === "win32") {
    return { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  }
  if (process.platform === "darwin") {
    return { file: "open", args: [url] };
  }
  return { file: "xdg-open", args: [url] };
}

function buildResult(stdout: string[], stderr: string[], exitCode: number): WeixinLoginCliResult {
  return {
    stdout: stdout.length > 0 ? `${stdout.join("\n")}\n` : "",
    stderr: stderr.length > 0 ? `${stderr.join("\n")}\n` : "",
    exitCode
  };
}
