import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWeixinLoginCliArgs,
  runWeixinLoginCli
} from "../src/weixin-login-cli-runner.js";
import type { CompleteWeixinLoginInput } from "../src/weixin-login.js";

test("parses Weixin login CLI timing and QR URL file options", () => {
  const parsed = parseWeixinLoginCliArgs([
    "--timeout-ms",
    "120000",
    "--poll-ms",
    "500",
    "--qr-url-file",
    ".runtime/weixin-login/qr-url.txt"
  ]);

  assert.equal(parsed.timeoutMs, 120000);
  assert.equal(parsed.pollIntervalMs, 500);
  assert.equal(parsed.qrUrlFile, ".runtime/weixin-login/qr-url.txt");
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
