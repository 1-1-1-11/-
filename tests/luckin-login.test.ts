import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildLuckinLoginUrl,
  extractLuckinTokenFromCallback,
  loginLuckin,
  parseLuckinLoginArgs,
  runLuckinLoginCli
} from "../src/luckin-login.js";

test("parses Luckin browser login CLI options", () => {
  const parsed = parseLuckinLoginArgs([
    "--token-file",
    "token.txt",
    "--config",
    "config.json",
    "--login-url",
    "https://open.example.com/cli",
    "--timeout-ms",
    "120000",
    "--open-browser",
    "--enable"
  ]);

  assert.equal(parsed.tokenPath, "token.txt");
  assert.equal(parsed.configPath, "config.json");
  assert.equal(parsed.loginBaseUrl, "https://open.example.com/cli");
  assert.equal(parsed.timeoutMs, 120000);
  assert.equal(parsed.openBrowser, true);
  assert.equal(parsed.enable, true);
});

test("builds Luckin hosted login URL with local callback", () => {
  const url = buildLuckinLoginUrl({
    loginBaseUrl: "https://open.lkcoffee.com/cli",
    callbackUrl: "http://127.0.0.1:1234/callback",
    cliSession: "session-1"
  });
  const parsed = new URL(url);

  assert.equal(parsed.origin + parsed.pathname, "https://open.lkcoffee.com/cli");
  assert.equal(parsed.searchParams.get("auth"), "login");
  assert.equal(parsed.searchParams.get("cli_session"), "session-1");
  assert.equal(parsed.searchParams.get("redirect_url"), "http://127.0.0.1:1234/callback");
});

test("extracts Luckin token from callback query and POST bodies", () => {
  assert.equal(
    extractLuckinTokenFromCallback({ url: "/callback?token=query-token-1234567890" }),
    "query-token-1234567890"
  );
  assert.equal(
    extractLuckinTokenFromCallback({
      url: "/callback",
      method: "POST",
      body: JSON.stringify({ access_token: "json-token-1234567890" })
    }),
    "json-token-1234567890"
  );
  assert.equal(
    extractLuckinTokenFromCallback({
      url: "/callback",
      method: "POST",
      body: "Authorization=Bearer+form-token-1234567890"
    }),
    "form-token-1234567890"
  );
});

test("Luckin login imports direct token without printing token value", async () => {
  const result = await runLuckinLoginCli(["--token-file", "token.txt", "--token", "direct-token-1234567890"], {
    mkdir: async () => undefined,
    writeFile: async () => undefined
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /瑞幸 token 已导入/);
  assert.doesNotMatch(result.text, /direct-token/);
});

test("Luckin browser login imports callback token and can enable source", async () => {
  let enabled = false;
  const result = await loginLuckin(
    {
      tokenPath: "token.txt",
      configPath: "config.json",
      enable: true,
      loginBaseUrl: "https://open.lkcoffee.com/cli",
      openBrowser: false,
      timeoutMs: 1000
    },
    {
      waitForToken: async () => ({
        token: "browser-token-1234567890",
        loginUrl: "https://open.lkcoffee.com/cli?auth=login"
      }),
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      enableLuckinMcp: async (options) => {
        enabled = options.configPath === "config.json";
        return { configPath: options.configPath, changed: true, text: "enabled" };
      }
    }
  );

  assert.equal(enabled, true);
  assert.equal(result.enabled, true);
  assert.match(result.text, /瑞幸浏览器登录已完成/);
});

test("package exposes Luckin login script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["luckin:login"], /luckin-login-cli\.ts/);
});
