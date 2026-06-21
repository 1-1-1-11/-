import assert from "node:assert/strict";
import test from "node:test";

import { bindLuckinTokenFromMessage } from "../src/luckin-token-bind.js";

test("binds a Luckin token from a WeChat message without echoing the secret", async () => {
  let writtenPath = "";
  let writtenContent = "";
  let enabledConfigPath = "";

  const result = await bindLuckinTokenFromMessage(
    {
      message: "绑定瑞幸 token Authorization: Bearer secret-token-1234567890",
      tokenPath: "token.txt",
      configPath: "config.json"
    },
    {
      mkdir: async () => undefined,
      writeFile: async (path, content) => {
        writtenPath = path;
        writtenContent = content;
      },
      enableLuckinMcp: async (options) => {
        enabledConfigPath = options.configPath;
        return { configPath: options.configPath, changed: true, text: "enabled" };
      }
    }
  );

  assert.equal(writtenPath, "token.txt");
  assert.equal(writtenContent, "secret-token-1234567890\n");
  assert.equal(enabledConfigPath, "config.json");
  assert.equal(result.ok, true);
  assert.match(result.text, /瑞幸实时价 token 已绑定/);
  assert.doesNotMatch(result.text, /secret-token/);
});

test("returns a safe failure when no Luckin token is present", async () => {
  const result = await bindLuckinTokenFromMessage(
    {
      message: "绑定瑞幸 token 但是这里没有真正的 token",
      tokenPath: "token.txt",
      configPath: "config.json"
    },
    {
      mkdir: async () => {
        throw new Error("should not write");
      }
    }
  );

  assert.equal(result.ok, false);
  assert.match(result.text, /没有识别到瑞幸 MCP token/);
  assert.match(result.text, /瑞幸开放平台/);
});
