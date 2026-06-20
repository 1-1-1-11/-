import { dirname } from "node:path";
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
}

export interface WeixinLoginCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface WeixinLoginCliDeps {
  completeWeixinLogin?: (input: CompleteWeixinLoginInput) => Promise<CompleteWeixinLoginResult>;
  writeQrUrlFile?: (path: string, content: string) => Promise<void>;
}

export function parseWeixinLoginCliArgs(args: string[]): WeixinLoginCliOptions {
  return {
    timeoutMs: readNumberOption(args, "--timeout-ms") ?? 480_000,
    pollIntervalMs: readNumberOption(args, "--poll-ms") ?? 1000,
    qrUrlFile: readStringOption(args, "--qr-url-file")
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

function buildResult(stdout: string[], stderr: string[], exitCode: number): WeixinLoginCliResult {
  return {
    stdout: stdout.length > 0 ? `${stdout.join("\n")}\n` : "",
    stderr: stderr.length > 0 ? `${stderr.join("\n")}\n` : "",
    exitCode
  };
}
