import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import { enableLuckinMcp } from "./luckin-mcp-enable.js";

export interface LuckinTokenImportOptions {
  tokenText?: string;
  tokenPath: string;
  configPath: string;
  enable: boolean;
}

export interface LuckinTokenImportResult {
  tokenPath: string;
  enabled: boolean;
  text: string;
}

export interface LuckinTokenImportDeps {
  stdin?: string;
  writeFile?: (path: string, content: string, options: { encoding: BufferEncoding; mode?: number }) => Promise<void>;
  mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  enableLuckinMcp?: typeof enableLuckinMcp;
}

const DEFAULT_TOKEN_PATH = join(homedir(), ".my-coffee", "LUCKIN_MCP_TOKEN");

export function parseLuckinTokenImportArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): LuckinTokenImportOptions {
  const options: LuckinTokenImportOptions = {
    tokenPath: env.LUCKIN_MCP_TOKEN_FILE ?? DEFAULT_TOKEN_PATH,
    configPath: "config/coffee-price.config.json",
    enable: args.includes("--enable")
  };

  const tokenTextParts: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--enable") {
      continue;
    }
    if (arg === "--token-file") {
      if (!next) {
        throw new Error("--token-file 缺少参数值");
      }
      options.tokenPath = next;
      index += 1;
      continue;
    }
    if (arg === "--config") {
      if (!next) {
        throw new Error("--config 缺少参数值");
      }
      options.configPath = next;
      index += 1;
      continue;
    }
    if (arg === "--token") {
      if (!next) {
        throw new Error("--token 缺少参数值");
      }
      tokenTextParts.push(next);
      index += 1;
      continue;
    }
    tokenTextParts.push(arg);
  }

  if (tokenTextParts.length) {
    options.tokenText = tokenTextParts.join(" ");
  }
  return options;
}

export async function runLuckinTokenImportCli(
  args: string[],
  deps: LuckinTokenImportDeps = {}
): Promise<{ text: string; exitCode: number; result?: LuckinTokenImportResult }> {
  try {
    const result = await importLuckinToken(parseLuckinTokenImportArgs(args), deps);
    return {
      text: `${result.text}\n`,
      exitCode: 0,
      result
    };
  } catch (error) {
    return {
      text: `瑞幸 token 导入失败：${error instanceof Error ? error.message : String(error)}\n`,
      exitCode: 1
    };
  }
}

export async function importLuckinToken(
  options: LuckinTokenImportOptions,
  deps: LuckinTokenImportDeps = {}
): Promise<LuckinTokenImportResult> {
  const input = options.tokenText ?? deps.stdin ?? (await readStdin());
  const token = extractLuckinToken(input);
  if (!token) {
    throw new Error("没有从输入中识别到 token；请粘贴原始 token、Bearer 头、JSON 或开放平台授权命令");
  }

  const makeDir = deps.mkdir ?? mkdir;
  const writer = deps.writeFile ?? writeFile;
  await makeDir(dirname(options.tokenPath), { recursive: true });
  await writer(options.tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });

  if (options.enable) {
    await (deps.enableLuckinMcp ?? enableLuckinMcp)({
      configPath: options.configPath,
      dryRun: false
    });
  }

  return {
    tokenPath: options.tokenPath,
    enabled: options.enable,
    text: [
      `已保存瑞幸 token：${options.tokenPath}`,
      options.enable ? `已启用 luckinMcp：${options.configPath}` : "未修改 luckinMcp 启用状态"
    ].join("\n")
  };
}

export function extractLuckinToken(input: string): string | null {
  const text = input.trim();
  if (!text) {
    return null;
  }

  const jsonToken = extractJsonToken(text);
  if (jsonToken) {
    return jsonToken;
  }

  const patterns = [
    /Authorization["']?\s*[:=]\s*["']?Bearer\s+([^"'\s,}]+)/i,
    /Bearer\s+([A-Za-z0-9._~+/=-]{16,})/i,
    /LUCKIN_MCP_TOKEN\s*=\s*["']?([^"'\s]+)/i,
    /--token\s+["']?([^"'\s]+)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return sanitizeToken(match[1]);
    }
  }

  if (/^[A-Za-z0-9._~+/=-]{16,}$/.test(text)) {
    return text;
  }
  return null;
}

function extractJsonToken(text: string): string | null {
  try {
    const parsed = JSON.parse(text);
    return findTokenInJson(parsed);
  } catch {
    return null;
  }
}

function findTokenInJson(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTokenInJson(item);
      if (found) {
        return found;
      }
    }
    return null;
  }

  const object = value as Record<string, unknown>;
  for (const key of ["token", "access_token", "accessToken", "bearerToken", "apiKey"]) {
    const candidate = object[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return sanitizeToken(candidate);
    }
  }

  const authorization = object.Authorization ?? object.authorization;
  if (typeof authorization === "string") {
    const match = authorization.match(/Bearer\s+(.+)/i);
    return sanitizeToken(match?.[1] ?? authorization);
  }

  for (const candidate of Object.values(object)) {
    const found = findTokenInJson(candidate);
    if (found) {
      return found;
    }
  }
  return null;
}

function sanitizeToken(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "");
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
