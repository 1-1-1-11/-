import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  setupGenericMcpSource,
  type GenericMcpSetupOptions,
  type GenericMcpSetupResult
} from "./generic-mcp-setup.js";

export interface McpSourceBindInput {
  message: string;
  configPath?: string;
  tokenDir?: string;
}

export interface McpSourceBindResult {
  ok: boolean;
  text: string;
}

export interface McpSourceBindDeps {
  mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  writeFile?: (
    path: string,
    content: string,
    options?: { encoding: BufferEncoding; mode?: number }
  ) => Promise<unknown>;
  setupGenericMcpSource?: (options: GenericMcpSetupOptions) => Promise<GenericMcpSetupResult>;
}

const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";
const DEFAULT_TOKEN_DIR = join(homedir(), ".my-coffee", "mcp-tokens");
const DEFAULT_TIMEOUT_MS = 120_000;
const GUIDANCE =
  "请在微信私聊发送：接入MCP endpoint https://example.com/mcp tool coffee_price_search token Authorization: Bearer <你的 MCP token>。也可以加 id 和 label，例如：接入MCP id coffeeLive label 实时咖啡 MCP endpoint https://example.com/mcp tool coffee_price_search token Authorization: Bearer <token>。不会回显 token，也不会自动下单。";

interface ParsedMcpSourceMessage {
  id: string;
  label: string;
  endpoint: string | null;
  toolName: string | null;
  token: string | null;
}

export async function bindMcpSourceFromMessage(
  input: McpSourceBindInput,
  deps: McpSourceBindDeps = {}
): Promise<McpSourceBindResult> {
  const parsed = parseMcpSourceMessage(input.message);
  if (!parsed.endpoint || !parsed.toolName) {
    return {
      ok: false,
      text: GUIDANCE
    };
  }

  const configPath = input.configPath ?? process.env.COFFEE_PRICE_CONFIG ?? DEFAULT_CONFIG_PATH;
  const tokenDir = input.tokenDir ?? process.env.COFFEE_PRICE_MCP_TOKEN_DIR ?? DEFAULT_TOKEN_DIR;
  const tokenPath = parsed.token ? join(tokenDir, `${parsed.id}.token`) : undefined;

  try {
    if (parsed.token && tokenPath) {
      await (deps.mkdir ?? mkdir)(dirname(tokenPath), { recursive: true });
      await (deps.writeFile ?? writeFile)(tokenPath, `${parsed.token}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
    }

    const result = await (deps.setupGenericMcpSource ?? setupGenericMcpSource)({
      configPath,
      id: parsed.id,
      label: parsed.label,
      endpoint: parsed.endpoint,
      transport: "http",
      toolName: parsed.toolName,
      toolResultPath: "snapshot",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      bearerTokenFile: tokenPath,
      dryRun: false,
      probeCall: false,
      sampleMessage: "查公司附近冰美式",
      json: false
    });

    if (result.status === "fail") {
      return {
        ok: false,
        text: redactSecret(
          [
            `MCP 查价源接入失败：${parsed.id}`,
            `endpoint: ${parsed.endpoint}`,
            `tool: ${parsed.toolName}`,
            ...formatChecks(result),
            "没有启用到可用查价榜单；请确认 MCP 地址、token 权限和 tool 名称。不会自动下单。"
          ].join("\n")
        )
      };
    }

    return {
      ok: true,
      text: redactSecret(
        [
          `已接入 MCP 查价源：${parsed.id}`,
          `名称：${parsed.label}`,
          `endpoint: ${parsed.endpoint}`,
          `tool: ${parsed.toolName}`,
          `已保存 token：${tokenPath ? "是" : "否"}`,
          `配置文件：${result.configPath}`,
          result.changed ? "配置已更新，下一次查价会尝试这个来源。" : "配置已存在，下一次查价会继续尝试这个来源。",
          "token 只会用于本地查价源鉴权，不会回显；工具只查价和返回链接，不会自动下单。"
        ].join("\n")
      )
    };
  } catch (error) {
    return {
      ok: false,
      text: redactSecret(`MCP 查价源接入失败：${errorMessage(error)}\n${GUIDANCE}`)
    };
  }
}

function parseMcpSourceMessage(message: string): ParsedMcpSourceMessage {
  const endpoint = parseEndpoint(message);
  const id = parseSafeValue(message, /\bid\s+([A-Za-z0-9_-]+)/i) ?? deriveId(endpoint);
  const label = parseLabel(message) ?? `${id} MCP 查价源`;
  return {
    id,
    label,
    endpoint,
    toolName:
      parseSafeValue(message, /\b(?:tool|toolName|tool-name)\s+([A-Za-z0-9_-]+)/i) ??
      parseSafeValue(message, /工具\s+([A-Za-z0-9_-]+)/i),
    token: parseToken(message)
  };
}

function parseEndpoint(message: string): string | null {
  return (
    parseUrl(message, /\b(?:endpoint|url)\s+(https?:\/\/[^\s，,。；;]+)/i) ??
    parseUrl(message, /(https?:\/\/[^\s，,。；;]+)/i)
  );
}

function parseUrl(message: string, regex: RegExp): string | null {
  const value = regex.exec(message)?.[1];
  if (!value) {
    return null;
  }
  return cleanValue(value);
}

function parseLabel(message: string): string | null {
  const label =
    /\blabel\s+(.+?)(?=\s+(?:endpoint|url|tool|toolName|tool-name|token|Authorization|Bearer|id)\b|$)/i.exec(
      message
    )?.[1] ??
    /(?:名称|名字)\s+(.+?)(?=\s+(?:endpoint|url|tool|toolName|tool-name|工具|token|Authorization|Bearer|id)\b|$)/i.exec(
      message
    )?.[1];
  return label ? cleanValue(label) : null;
}

function parseToken(message: string): string | null {
  const token =
    /Authorization\s*:\s*Bearer\s+([^\s]+)/i.exec(message)?.[1] ??
    /\bBearer\s+([^\s]+)/i.exec(message)?.[1] ??
    /\btoken\s+([A-Za-z0-9._~+/=-]{16,})/i.exec(message)?.[1];
  return token ? cleanValue(token.replace(/^Bearer\s+/i, "")) : null;
}

function parseSafeValue(message: string, regex: RegExp): string | null {
  const value = regex.exec(message)?.[1];
  return value ? cleanValue(value) : null;
}

function deriveId(endpoint: string | null): string {
  if (!endpoint) {
    return "genericMcp";
  }
  try {
    const host = new URL(endpoint).hostname.replace(/^www\./i, "");
    const candidate = host.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    return candidate || "genericMcp";
  } catch {
    return "genericMcp";
  }
}

function cleanValue(value: string): string {
  return value.trim().replace(/[，,。；;。]+$/g, "");
}

function formatChecks(result: GenericMcpSetupResult): string[] {
  return result.checks.map((check) => {
    const detail = check.detail ? `：${check.detail}` : "";
    return `- [${check.status.toUpperCase()}] ${check.label}：${check.message}${detail}`;
  });
}

function redactSecret(text: string): string {
  return text
    .replace(/Authorization\s*:\s*Bearer\s+[^\s]+/gi, "Authorization: Bearer <redacted>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <redacted>")
    .replace(/secret-token-[A-Za-z0-9._~+/=-]*/gi, "<redacted>");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
