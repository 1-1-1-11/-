import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  extractLuckinToken,
  importLuckinToken,
  type LuckinTokenImportDeps,
  type LuckinTokenImportResult
} from "./luckin-token-import.js";

export interface LuckinLoginOptions {
  tokenText?: string;
  tokenPath: string;
  configPath: string;
  enable: boolean;
  loginBaseUrl: string;
  openBrowser: boolean;
  timeoutMs: number;
}

export interface LuckinLoginResult {
  tokenPath: string;
  enabled: boolean;
  loginUrl?: string;
  text: string;
}

export interface LuckinLoginDeps extends LuckinTokenImportDeps {
  waitForToken?: (options: LuckinLoginOptions) => Promise<{ token: string; loginUrl: string }>;
  openUrl?: (url: string) => boolean;
}

const DEFAULT_TOKEN_PATH = join(homedir(), ".my-coffee", "LUCKIN_MCP_TOKEN");
const DEFAULT_LOGIN_BASE_URL = "https://open.lkcoffee.com/cli";

export function parseLuckinLoginArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): LuckinLoginOptions {
  const options: LuckinLoginOptions = {
    tokenPath: env.LUCKIN_MCP_TOKEN_FILE ?? DEFAULT_TOKEN_PATH,
    configPath: "config/coffee-price.config.json",
    enable: args.includes("--enable"),
    loginBaseUrl: env.LUCKIN_LOGIN_URL ?? DEFAULT_LOGIN_BASE_URL,
    openBrowser: args.includes("--open-browser"),
    timeoutMs: parsePositiveInteger(env.LUCKIN_LOGIN_TIMEOUT_MS) ?? 180_000
  };

  const tokenTextParts: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--enable":
      case "--open-browser":
        break;
      case "--token":
        tokenTextParts.push(requireValue(arg, next));
        index += 1;
        break;
      case "--token-file":
        options.tokenPath = requireValue(arg, next);
        index += 1;
        break;
      case "--config":
        options.configPath = requireValue(arg, next);
        index += 1;
        break;
      case "--login-url":
        options.loginBaseUrl = requireValue(arg, next);
        index += 1;
        break;
      case "--timeout-ms":
        options.timeoutMs = parseRequiredPositiveInteger(arg, next);
        index += 1;
        break;
      default:
        tokenTextParts.push(arg);
        break;
    }
  }

  if (tokenTextParts.length) {
    options.tokenText = tokenTextParts.join(" ");
  }
  return options;
}

export async function runLuckinLoginCli(
  args: string[],
  deps: LuckinLoginDeps = {}
): Promise<{ text: string; exitCode: number; result?: LuckinLoginResult }> {
  try {
    const result = await loginLuckin(parseLuckinLoginArgs(args), deps);
    return {
      text: `${result.text}\n`,
      exitCode: 0,
      result
    };
  } catch (error) {
    return {
      text: `瑞幸登录失败：${error instanceof Error ? error.message : String(error)}\n`,
      exitCode: 1
    };
  }
}

export async function loginLuckin(
  options: LuckinLoginOptions,
  deps: LuckinLoginDeps = {}
): Promise<LuckinLoginResult> {
  const token = options.tokenText
    ? extractLuckinToken(options.tokenText)
    : (await (deps.waitForToken ?? waitForLuckinBrowserToken)(options, deps)).token;
  if (!token) {
    throw new Error("没有获取到瑞幸 MCP token");
  }

  const imported = await importLuckinToken({
    tokenText: token,
    tokenPath: options.tokenPath,
    configPath: options.configPath,
    enable: options.enable
  }, deps);

  return formatLoginResult(imported, options.tokenText ? undefined : "browser");
}

export function buildLuckinLoginUrl(input: {
  loginBaseUrl: string;
  callbackUrl: string;
  cliSession: string;
}): string {
  const url = new URL(input.loginBaseUrl);
  url.searchParams.set("auth", "login");
  url.searchParams.set("cli_session", input.cliSession);
  url.searchParams.set("redirect_url", input.callbackUrl);
  return url.toString();
}

export function extractLuckinTokenFromCallback(input: {
  url: string;
  method?: string;
  body?: string;
}): string | null {
  const url = new URL(input.url, "http://127.0.0.1");
  const queryToken = extractLuckinToken(JSON.stringify(Object.fromEntries(url.searchParams.entries())));
  if (queryToken) {
    return queryToken;
  }
  if ((input.method ?? "GET").toUpperCase() !== "POST" || !input.body) {
    return null;
  }
  try {
    const jsonToken = extractLuckinToken(JSON.stringify(JSON.parse(input.body)));
    if (jsonToken) {
      return jsonToken;
    }
  } catch {
    // Not JSON; try form-encoded next.
  }
  const formEntries = Object.fromEntries(new URLSearchParams(input.body).entries());
  const formToken = extractLuckinToken(JSON.stringify(formEntries));
  return formToken ?? extractLuckinToken(input.body);
}

async function waitForLuckinBrowserToken(
  options: LuckinLoginOptions,
  deps: Pick<LuckinLoginDeps, "openUrl"> = {}
): Promise<{ token: string; loginUrl: string }> {
  const cliSession = randomUUID();
  let server: Server | null = null;
  let timeout: NodeJS.Timeout | null = null;

  return new Promise((resolve, reject) => {
    const finish = (error: Error | null, value?: { token: string; loginUrl: string }) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      server?.close();
      if (error) {
        reject(error);
      } else {
        resolve(value!);
      }
    };

    server = createServer(async (request, response) => {
      await handleCallbackRequest(request, response, (token) => {
        finish(null, { token, loginUrl });
      });
    });

    server.once("error", (error) => finish(error instanceof Error ? error : new Error(String(error))));
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      if (!address || typeof address === "string") {
        finish(new Error("无法获取本地回调端口"));
        return;
      }
      const callbackUrl = `http://127.0.0.1:${address.port}/callback`;
      loginUrl = buildLuckinLoginUrl({
        loginBaseUrl: options.loginBaseUrl,
        callbackUrl,
        cliSession
      });
      if (options.openBrowser) {
        (deps.openUrl ?? openUrl)(loginUrl);
      }
      process.stdout.write([
        "请在浏览器打开瑞幸登录链接，完成后 token 会写入本机：",
        loginUrl,
        ""
      ].join("\n"));
      timeout = setTimeout(() => finish(new Error(`等待瑞幸登录超时：${options.timeoutMs}ms`)), options.timeoutMs);
    });

    let loginUrl = "";
  });
}

async function handleCallbackRequest(
  request: IncomingMessage,
  response: ServerResponse,
  onToken: (token: string) => void
): Promise<void> {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/callback") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }

  const body = request.method === "POST" ? await readRequestBody(request) : undefined;
  const token = extractLuckinTokenFromCallback({
    url: request.url ?? "/",
    method: request.method,
    body
  });
  if (!token) {
    response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><meta charset=\"utf-8\"><h2>瑞幸登录失败</h2><p>回调中未找到 token。</p>");
    return;
  }

  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end("<!doctype html><meta charset=\"utf-8\"><h2>瑞幸登录成功</h2><p>可以关闭此页面。</p>");
  onToken(token);
}

function openUrl(url: string): boolean {
  const command = process.platform === "win32"
    ? "cmd"
    : process.platform === "darwin"
      ? "open"
      : "xdg-open";
  const args = process.platform === "win32"
    ? ["/c", "start", "", url]
    : [url];
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function formatLoginResult(imported: LuckinTokenImportResult, via?: "browser"): LuckinLoginResult {
  return {
    tokenPath: imported.tokenPath,
    enabled: imported.enabled,
    text: [
      via === "browser" ? "瑞幸浏览器登录已完成" : "瑞幸 token 已导入",
      imported.text
    ].join("\n")
  };
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1024 * 1024) {
        request.destroy(new Error("请求体过大"));
      }
    });
    request.once("error", reject);
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseRequiredPositiveInteger(flag: string, value: string | undefined): number {
  const parsed = parsePositiveInteger(requireValue(flag, value));
  if (!parsed) {
    throw new Error(`${flag} 必须是正整数`);
  }
  return parsed;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} 缺少参数值`);
  }
  return value;
}
