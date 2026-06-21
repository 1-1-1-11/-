import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { enableMcdOfficialSource, type McdEnableOptions, type McdEnableResult } from "./mcd-official-enable.js";

export interface McdTokenBindInput {
  message: string;
  tokenPath?: string;
  configPath?: string;
}

export interface McdTokenBindResult {
  ok: boolean;
  text: string;
}

export interface McdTokenBindDeps {
  mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  writeFile?: (path: string, content: string, options: { encoding: BufferEncoding; mode?: number }) => Promise<unknown>;
  enableMcdOfficialSource?: (options: McdEnableOptions) => Promise<McdEnableResult>;
}

const DEFAULT_TOKEN_PATH = join(homedir(), ".my-coffee", "MCD_MCP_TOKEN");
const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";

export async function bindMcdTokenFromMessage(
  input: McdTokenBindInput,
  deps: McdTokenBindDeps = {}
): Promise<McdTokenBindResult> {
  const token = extractMcdToken(input.message);
  if (!token) {
    return {
      ok: false,
      text:
        "没有识别到麦当劳 MCP token。请在 https://open.mcd.cn/mcp 获取 token 后，在微信私聊发送：绑定麦当劳 token Authorization: Bearer <你的麦当劳 MCP token>。不要把 token 发到群聊。"
    };
  }

  const tokenPath = input.tokenPath ?? process.env.MCD_MCP_TOKEN_FILE ?? DEFAULT_TOKEN_PATH;
  const configPath = input.configPath ?? process.env.COFFEE_PRICE_CONFIG ?? DEFAULT_CONFIG_PATH;
  await (deps.mkdir ?? mkdir)(dirname(tokenPath), { recursive: true });
  await (deps.writeFile ?? writeFile)(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  const enabled = await (deps.enableMcdOfficialSource ?? enableMcdOfficialSource)({
    configPath,
    dryRun: false
  });

  return {
    ok: true,
    text: [
      "麦当劳实时价 token 已绑定。",
      `已启用 mcdOfficial：${enabled.changed ? "是" : "已存在"}`,
      "下一次查价会尝试麦当劳官方 MCP 的自取实时价格；不会回显 token，也不会自动下单。"
    ].join("\n")
  };
}

export function extractMcdToken(input: string): string | null {
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
    /MCD(?:_MCP)?_TOKEN\s*=\s*["']?([^"'\s]+)/i,
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
    return findTokenInJson(JSON.parse(text));
  } catch {
    return null;
  }
}

function findTokenInJson(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findTokenInJson(entry);
      if (found) {
        return found;
      }
    }
    return null;
  }
  const object = value as Record<string, unknown>;
  for (const key of ["token", "access_token", "accessToken", "bearerToken", "apiKey"]) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) {
      return sanitizeToken(value);
    }
  }
  const authorization = object.Authorization ?? object.authorization;
  if (typeof authorization === "string") {
    const match = authorization.match(/Bearer\s+(.+)/i);
    return sanitizeToken(match?.[1] ?? authorization);
  }
  for (const entry of Object.values(object)) {
    const found = findTokenInJson(entry);
    if (found) {
      return found;
    }
  }
  return null;
}

function sanitizeToken(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "");
}
