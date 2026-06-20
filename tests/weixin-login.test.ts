import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  completeWeixinLogin,
  normalizeWeixinAccountId
} from "../src/weixin-login.js";
import type { WeixinLoginFetch } from "../src/weixin-login.js";

test("normalizes Weixin account ids for filesystem-safe credential files", () => {
  assert.equal(normalizeWeixinAccountId("abc123@im.bot"), "abc123-im-bot");
  assert.equal(normalizeWeixinAccountId("abc123@im.wechat"), "abc123-im-wechat");
});

test("direct Weixin login saves confirmed account credentials", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "coffee-weixin-login-"));
  const configPath = join(stateDir, "openclaw.json");
  const requests: { method: string; url: string }[] = [];
  const fetcher: WeixinLoginFetch = async (url, init) => {
    requests.push({ method: init?.method ?? "GET", url });
    if (url.includes("get_bot_qrcode")) {
      return {
        qrcode: "qr-token",
        qrcode_img_content: "https://liteapp.weixin.qq.com/q/example",
        ret: 0
      };
    }
    return {
      status: "confirmed",
      bot_token: "bot-token",
      ilink_bot_id: "abc123@im.bot",
      ilink_user_id: "user-1",
      baseurl: "https://ilinkai.weixin.qq.com"
    };
  };

  const result = await completeWeixinLogin({
    stateDir,
    configPath,
    fetcher,
    pollIntervalMs: 0,
    timeoutMs: 1000,
    onQrCode: () => undefined
  });

  assert.equal(result.status, "connected");
  assert.equal(result.qrcodeUrl, "https://liteapp.weixin.qq.com/q/example");
  assert.equal(result.accountId, "abc123-im-bot");
  assert.equal(requests[0]?.method, "POST");
  assert.match(requests[1]?.url ?? "", /get_qrcode_status/);

  const index = JSON.parse(
    await readFile(join(stateDir, "openclaw-weixin", "accounts.json"), "utf8")
  );
  assert.deepEqual(index, ["abc123-im-bot"]);

  const account = JSON.parse(
    await readFile(
      join(stateDir, "openclaw-weixin", "accounts", "abc123-im-bot.json"),
      "utf8"
    )
  );
  assert.equal(account.token, "bot-token");
  assert.equal(account.userId, "user-1");
  assert.equal(account.baseUrl, "https://ilinkai.weixin.qq.com");

  const openclawConfig = JSON.parse(await readFile(configPath, "utf8"));
  assert.match(
    openclawConfig.channels["openclaw-weixin"].channelConfigUpdatedAt,
    /^\d{4}-\d{2}-\d{2}T/
  );
});

test("direct Weixin login sends recent local bot tokens when requesting QR code", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "coffee-weixin-login-tokens-"));
  const configPath = join(stateDir, "openclaw.json");
  await mkdir(join(stateDir, "openclaw-weixin", "accounts"), { recursive: true });
  await writeFile(
    join(stateDir, "openclaw-weixin", "accounts.json"),
    `${JSON.stringify(["old-account", "new-account"])}\n`,
    "utf8"
  );
  await writeFile(
    join(stateDir, "openclaw-weixin", "accounts", "old-account.json"),
    `${JSON.stringify({ token: "old-token" })}\n`,
    "utf8"
  );
  await writeFile(
    join(stateDir, "openclaw-weixin", "accounts", "new-account.json"),
    `${JSON.stringify({ token: "new-token" })}\n`,
    "utf8"
  );
  let qrBody = "";
  const fetcher: WeixinLoginFetch = async (url, init) => {
    if (url.includes("get_bot_qrcode")) {
      qrBody = init?.body ?? "";
      return {
        qrcode: "qr-token",
        qrcode_img_content: "https://liteapp.weixin.qq.com/q/example",
        ret: 0
      };
    }
    return {
      status: "confirmed",
      bot_token: "bot-token",
      ilink_bot_id: "abc123@im.bot"
    };
  };

  await completeWeixinLogin({
    stateDir,
    configPath,
    fetcher,
    pollIntervalMs: 0,
    timeoutMs: 1000,
    onQrCode: () => undefined
  });

  assert.deepEqual(JSON.parse(qrBody).local_token_list, ["new-token", "old-token"]);
});

test("package exposes direct Weixin login script with network preload", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["weixin:login"], /openclaw-network-preload\.mjs/);
  assert.match(pkg.scripts["weixin:login"], /weixin-login-cli\.ts/);
});

test("direct Weixin login passes an abort signal to long-poll status requests", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "coffee-weixin-login-signal-"));
  const statusSignals: unknown[] = [];
  const fetcher: WeixinLoginFetch = async (url, init) => {
    if (url.includes("get_bot_qrcode")) {
      return {
        qrcode: "qr-token",
        qrcode_img_content: "https://liteapp.weixin.qq.com/q/example",
        ret: 0
      };
    }
    statusSignals.push(init?.signal);
    return { status: "wait" };
  };

  const result = await completeWeixinLogin({
    stateDir,
    configPath: join(stateDir, "openclaw.json"),
    fetcher,
    pollIntervalMs: 0,
    timeoutMs: 1,
    statusRequestTimeoutMs: 500,
    onQrCode: () => undefined
  });

  assert.equal(result.status, "timeout");
  assert.ok(statusSignals[0] instanceof AbortSignal);
});

test("direct Weixin login reports timeout when status long-poll aborts at the deadline", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "coffee-weixin-login-abort-"));
  const fetcher: WeixinLoginFetch = async (url) => {
    if (url.includes("get_bot_qrcode")) {
      return {
        qrcode: "qr-token",
        qrcode_img_content: "https://liteapp.weixin.qq.com/q/example",
        ret: 0
      };
    }
    throw new DOMException("This operation was aborted", "AbortError");
  };

  const result = await completeWeixinLogin({
    stateDir,
    configPath: join(stateDir, "openclaw.json"),
    fetcher,
    pollIntervalMs: 0,
    timeoutMs: 1,
    statusRequestTimeoutMs: 1,
    onQrCode: () => undefined
  });

  assert.equal(result.status, "timeout");
});

test("direct Weixin login returns a clear failure when Weixin asks for verification code", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "coffee-weixin-login-verify-"));
  const fetcher: WeixinLoginFetch = async (url) => {
    if (url.includes("get_bot_qrcode")) {
      return {
        qrcode: "qr-token",
        qrcode_img_content: "https://liteapp.weixin.qq.com/q/example",
        ret: 0
      };
    }
    return { status: "need_verifycode" };
  };

  const result = await completeWeixinLogin({
    stateDir,
    configPath: join(stateDir, "openclaw.json"),
    fetcher,
    pollIntervalMs: 0,
    timeoutMs: 1000,
    onQrCode: () => undefined
  });

  assert.equal(result.status, "failed");
  assert.match(result.message, /验证码/);
});

test("direct Weixin login returns a clear failure when the QR code expires", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "coffee-weixin-login-expired-"));
  const fetcher: WeixinLoginFetch = async (url) => {
    if (url.includes("get_bot_qrcode")) {
      return {
        qrcode: "qr-token",
        qrcode_img_content: "https://liteapp.weixin.qq.com/q/example",
        ret: 0
      };
    }
    return { status: "expired" };
  };

  const result = await completeWeixinLogin({
    stateDir,
    configPath: join(stateDir, "openclaw.json"),
    fetcher,
    pollIntervalMs: 0,
    timeoutMs: 1000,
    onQrCode: () => undefined
  });

  assert.equal(result.status, "failed");
  assert.match(result.message, /过期/);
});
