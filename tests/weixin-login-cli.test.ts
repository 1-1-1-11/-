import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWeixinLoginCliArgs,
  runWeixinLoginCli
} from "../src/weixin-login-cli-runner.js";
import type { CompleteWeixinLoginInput } from "../src/weixin-login.js";

test("parses Weixin login CLI timing and QR output options", () => {
  const parsed = parseWeixinLoginCliArgs([
    "--timeout-ms",
    "120000",
    "--poll-ms",
    "500",
    "--qr-url-file",
    ".runtime/weixin-login/qr-url.txt",
    "--qr-html-file",
    ".runtime/weixin-login/qr.html",
    "--open-qr"
  ]);

  assert.equal(parsed.timeoutMs, 120000);
  assert.equal(parsed.pollIntervalMs, 500);
  assert.equal(parsed.qrUrlFile, ".runtime/weixin-login/qr-url.txt");
  assert.equal(parsed.qrHtmlFile, ".runtime/weixin-login/qr.html");
  assert.equal(parsed.openQr, true);
});

test("Weixin login CLI writes the QR URL to a requested file", async () => {
  let loginInput: CompleteWeixinLoginInput | undefined;
  const writes: Array<{ path: string; content: string }> = [];

  const result = await runWeixinLoginCli(["--qr-url-file", ".runtime/login/qr.txt"], {
    completeWeixinLogin: async (input) => {
      loginInput = input;
      await input.onQrCode?.("https://liteapp.weixin.qq.com/q/example");
      return {
        status: "timeout",
        qrcodeUrl: "https://liteapp.weixin.qq.com/q/example",
        message: "等待微信扫码确认超时"
      };
    },
    writeQrUrlFile: async (path, content) => {
      writes.push({ path, content });
    }
  });

  assert.equal(loginInput?.timeoutMs, 480000);
  assert.deepEqual(writes, [
    {
      path: ".runtime/login/qr.txt",
      content: "https://liteapp.weixin.qq.com/q/example\n"
    }
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /QR URL file/);
  assert.match(result.stdout, /https:\/\/liteapp\.weixin\.qq\.com\/q\/example/);
  assert.match(result.stderr, /等待微信扫码确认超时/);
});

test("Weixin login CLI writes a local QR HTML fallback when requested", async () => {
  const writes: Array<{ path: string; content: string }> = [];

  const result = await runWeixinLoginCli(["--qr-html-file", ".runtime/login/qr.html"], {
    completeWeixinLogin: async (input) => {
      await input.onQrCode?.("https://liteapp.weixin.qq.com/q/example?a=1&b=2");
      return {
        status: "timeout",
        qrcodeUrl: "https://liteapp.weixin.qq.com/q/example?a=1&b=2",
        message: "等待微信扫码确认超时"
      };
    },
    writeQrHtmlFile: async (path, content) => {
      writes.push({ path, content });
    }
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.path, ".runtime/login/qr.html");
  assert.match(writes[0]?.content ?? "", /<!doctype html>/i);
  assert.match(writes[0]?.content ?? "", /OpenClaw/);
  assert.match(writes[0]?.content ?? "", /https:\/\/liteapp\.weixin\.qq\.com\/q\/example\?a=1&amp;b=2/);
  assert.match(writes[0]?.content ?? "", /rel="noopener noreferrer"/);
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /QR HTML file/);
});

test("Weixin login CLI can open the QR URL in the default browser", async () => {
  const openedUrls: string[] = [];

  const result = await runWeixinLoginCli(["--open-qr"], {
    completeWeixinLogin: async (input) => {
      await input.onQrCode?.("https://liteapp.weixin.qq.com/q/example");
      return {
        status: "timeout",
        qrcodeUrl: "https://liteapp.weixin.qq.com/q/example",
        message: "等待微信扫码确认超时"
      };
    },
    openUrl: async (url) => {
      openedUrls.push(url);
    }
  });

  assert.deepEqual(openedUrls, ["https://liteapp.weixin.qq.com/q/example"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /Opened QR URL/);
});
