import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type WeixinLoginFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<unknown>;

export interface CompleteWeixinLoginInput {
  stateDir?: string;
  configPath?: string;
  fetcher?: WeixinLoginFetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
  statusRequestTimeoutMs?: number;
  onQrCode?: (qrcodeUrl: string) => void | Promise<void>;
  onStatus?: (status: string) => void | Promise<void>;
}

export type CompleteWeixinLoginResult =
  | {
      status: "connected";
      qrcodeUrl: string;
      accountId: string;
      rawAccountId: string;
      userId?: string;
    }
  | {
      status: "already_connected" | "timeout" | "failed";
      qrcodeUrl?: string;
      message: string;
    };

interface QrResponse {
  qrcode: string;
  qrcode_img_content: string;
  ret?: number;
}

interface QrStatusResponse {
  status: string;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
}

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_BOT_TYPE = "3";

export async function completeWeixinLogin(
  input: CompleteWeixinLoginInput = {}
): Promise<CompleteWeixinLoginResult> {
  const fetcher = input.fetcher ?? fetchJson;
  const pollIntervalMs = input.pollIntervalMs ?? 1000;
  const timeoutMs = input.timeoutMs ?? 480_000;
  const statusRequestTimeoutMs = input.statusRequestTimeoutMs ?? 15_000;
  const stateDir = input.stateDir ?? resolveDefaultOpenClawStateDir();
  const configPath = input.configPath ?? resolveDefaultOpenClawConfigPath();
  const qr = await fetchQrCode(fetcher, await loadLocalBotTokens(stateDir));
  await input.onQrCode?.(qr.qrcode_img_content);

  const deadline = Date.now() + timeoutMs;
  let baseUrl = DEFAULT_BASE_URL;
  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    let status: QrStatusResponse;
    try {
      status = await fetchQrStatus(
        fetcher,
        baseUrl,
        qr.qrcode,
        Math.min(statusRequestTimeoutMs, remainingMs)
      );
    } catch (error) {
      if (isAbortError(error)) {
        if (Date.now() >= deadline) {
          break;
        }
        continue;
      }
      return {
        status: "failed",
        qrcodeUrl: qr.qrcode_img_content,
        message: `微信扫码状态请求失败: ${describeError(error)}。请确认网络/代理可访问 ${baseUrl}，然后重新运行 npm run weixin:login；不要关闭命令窗口直到显示微信已连接。`
      };
    }
    await input.onStatus?.(status.status);

    if (status.status === "confirmed") {
      if (!status.bot_token || !status.ilink_bot_id) {
        return {
          status: "failed",
          qrcodeUrl: qr.qrcode_img_content,
          message: "登录确认成功，但服务器没有返回 bot token 或 bot id"
        };
      }
      const accountId = normalizeWeixinAccountId(status.ilink_bot_id);
      await saveWeixinAccount(stateDir, accountId, {
        token: status.bot_token,
        baseUrl: status.baseurl ?? baseUrl,
        userId: status.ilink_user_id
      });
      await registerWeixinAccountId(stateDir, accountId);
      await touchWeixinChannelConfigUpdatedAt(configPath);
      return {
        status: "connected",
        qrcodeUrl: qr.qrcode_img_content,
        accountId,
        rawAccountId: status.ilink_bot_id,
        userId: status.ilink_user_id
      };
    }

    if (status.status === "binded_redirect") {
      return {
        status: "already_connected",
        qrcodeUrl: qr.qrcode_img_content,
        message: "已连接过此 OpenClaw，无需重复连接"
      };
    }

    if (status.status === "scaned_but_redirect" && status.redirect_host) {
      baseUrl = `https://${status.redirect_host}`;
    }

    if (status.status === "need_verifycode" || status.status === "verify_code_blocked") {
      return {
        status: "failed",
        qrcodeUrl: qr.qrcode_img_content,
        message: "微信登录需要验证码验证，请改用 OpenClaw 官方登录命令完成交互式验证"
      };
    }

    if (status.status === "expired") {
      return {
        status: "failed",
        qrcodeUrl: qr.qrcode_img_content,
        message: "微信二维码已过期，请重新运行 npm run weixin:login"
      };
    }

    if (pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  return {
    status: "timeout",
    qrcodeUrl: qr.qrcode_img_content,
    message: "等待微信扫码确认超时"
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = error.cause;
  if (cause instanceof Error) {
    const code =
      typeof (cause as Error & { code?: unknown }).code === "string"
        ? `${(cause as Error & { code: string }).code}: `
        : "";
    return `${error.message} (${code}${cause.message})`;
  }
  return error.message;
}

export function normalizeWeixinAccountId(accountId: string): string {
  return accountId.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function resolveDefaultOpenClawStateDir(
  env: Partial<Record<"OPENCLAW_STATE_DIR" | "CLAWDBOT_STATE_DIR", string>> = process.env,
  home = homedir()
): string {
  return env.OPENCLAW_STATE_DIR?.trim() || env.CLAWDBOT_STATE_DIR?.trim() || join(home, ".openclaw");
}

export function resolveDefaultOpenClawConfigPath(
  env: Partial<Record<"OPENCLAW_CONFIG" | "OPENCLAW_STATE_DIR" | "CLAWDBOT_STATE_DIR", string>> = process.env,
  home = homedir()
): string {
  return env.OPENCLAW_CONFIG?.trim() || join(resolveDefaultOpenClawStateDir(env, home), "openclaw.json");
}

async function fetchQrCode(fetcher: WeixinLoginFetch, localTokenList: string[]): Promise<QrResponse> {
  const response = await fetcher(
    `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_BOT_TYPE)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ local_token_list: localTokenList.slice(0, 10) })
    }
  );
  const parsed = response as Partial<QrResponse>;
  if (!parsed.qrcode || !parsed.qrcode_img_content) {
    throw new Error("微信二维码接口没有返回 qrcode");
  }
  return {
    qrcode: parsed.qrcode,
    qrcode_img_content: parsed.qrcode_img_content,
    ret: parsed.ret
  };
}

async function fetchQrStatus(
  fetcher: WeixinLoginFetch,
  baseUrl: string,
  qrcode: string,
  timeoutMs: number
): Promise<QrStatusResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(
      `${baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      { method: "GET", signal: controller.signal }
    );
    const parsed = response as Partial<QrStatusResponse>;
    if (!parsed.status) {
      throw new Error("微信二维码状态接口没有返回 status");
    }
    return parsed as QrStatusResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url: string, init?: Parameters<WeixinLoginFetch>[1]): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function saveWeixinAccount(
  stateDir: string,
  accountId: string,
  data: { token: string; baseUrl?: string; userId?: string }
): Promise<void> {
  const dir = join(stateDir, "openclaw-weixin", "accounts");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${accountId}.json`);
  await writeFile(
    path,
    `${JSON.stringify(
      {
        token: data.token,
        savedAt: new Date().toISOString(),
        ...(data.baseUrl ? { baseUrl: data.baseUrl } : {}),
        ...(data.userId ? { userId: data.userId } : {})
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may ignore POSIX modes; best effort only.
  }
}

async function registerWeixinAccountId(stateDir: string, accountId: string): Promise<void> {
  const dir = join(stateDir, "openclaw-weixin");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "accounts.json");
  const existing = await readAccountIndex(path);
  if (!existing.includes(accountId)) {
    existing.push(accountId);
  }
  await writeFile(path, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
}

async function readAccountIndex(path: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

async function loadLocalBotTokens(stateDir: string): Promise<string[]> {
  const ids = await readAccountIndex(join(stateDir, "openclaw-weixin", "accounts.json"));
  const tokens: string[] = [];
  for (const id of ids.reverse()) {
    if (tokens.length >= 10) {
      break;
    }
    try {
      const account = JSON.parse(
        await readFile(join(stateDir, "openclaw-weixin", "accounts", `${id}.json`), "utf8")
      );
      if (typeof account.token === "string" && account.token.trim()) {
        tokens.push(account.token.trim());
      }
    } catch {
      // Ignore stale or malformed local account files.
    }
  }
  return tokens;
}

async function touchWeixinChannelConfigUpdatedAt(configPath: string): Promise<void> {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    config = {};
  }

  const channels =
    config.channels && typeof config.channels === "object" && !Array.isArray(config.channels)
      ? (config.channels as Record<string, unknown>)
      : {};
  const weixin =
    channels["openclaw-weixin"] &&
    typeof channels["openclaw-weixin"] === "object" &&
    !Array.isArray(channels["openclaw-weixin"])
      ? (channels["openclaw-weixin"] as Record<string, unknown>)
      : {};

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        ...config,
        channels: {
          ...channels,
          "openclaw-weixin": {
            ...weixin,
            channelConfigUpdatedAt: new Date().toISOString()
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}
