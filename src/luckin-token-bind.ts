import { join } from "node:path";
import { homedir } from "node:os";

import { importLuckinToken, type LuckinTokenImportDeps } from "./luckin-token-import.js";

export interface LuckinTokenBindInput {
  message: string;
  tokenPath?: string;
  configPath?: string;
}

export interface LuckinTokenBindResult {
  ok: boolean;
  text: string;
}

const DEFAULT_TOKEN_PATH = join(homedir(), ".my-coffee", "LUCKIN_MCP_TOKEN");
const DEFAULT_CONFIG_PATH = "config/coffee-price.config.json";

export async function bindLuckinTokenFromMessage(
  input: LuckinTokenBindInput,
  deps: LuckinTokenImportDeps = {}
): Promise<LuckinTokenBindResult> {
  try {
    const imported = await importLuckinToken(
      {
        tokenText: input.message,
        tokenPath: input.tokenPath ?? process.env.LUCKIN_MCP_TOKEN_FILE ?? DEFAULT_TOKEN_PATH,
        configPath: input.configPath ?? process.env.COFFEE_PRICE_CONFIG ?? DEFAULT_CONFIG_PATH,
        enable: true
      },
      deps
    );
    return {
      ok: true,
      text: [
        "瑞幸实时价 token 已绑定。",
        `已启用 luckinMcp：${imported.enabled ? "是" : "否"}`,
        "下一次查价会优先尝试瑞幸官方实时自取价；不会自动下单，也不会回显 token。"
      ].join("\n")
    };
  } catch {
    return {
      ok: false,
      text: "没有识别到瑞幸 MCP token。请从瑞幸开放平台复制 MCP token 后，在微信私聊发送：绑定瑞幸 token Authorization: Bearer <你的瑞幸 MCP token>。不会自动下单，也不要把 token 发到群聊。"
    };
  }
}
