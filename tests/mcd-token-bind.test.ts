import assert from "node:assert/strict";
import test from "node:test";

import { bindMcdTokenFromMessage } from "../src/mcd-token-bind.js";

test("binds a McDonald's MCP token from a private WeChat message without echoing it", async () => {
  let writtenPath = "";
  let writtenContent = "";
  let enabledConfigPath = "";

  const result = await bindMcdTokenFromMessage(
    {
      message: "绑定麦当劳 token Authorization: Bearer secret-token-1234567890",
      tokenPath: "mcd.token",
      configPath: "config.json"
    },
    {
      mkdir: async () => undefined,
      writeFile: async (path, content) => {
        writtenPath = path;
        writtenContent = content;
      },
      enableMcdOfficialSource: async (options) => {
        enabledConfigPath = options.configPath;
        return { configPath: options.configPath, changed: true, text: "enabled" };
      }
    }
  );

  assert.equal(writtenPath, "mcd.token");
  assert.equal(writtenContent, "secret-token-1234567890\n");
  assert.equal(enabledConfigPath, "config.json");
  assert.equal(result.ok, true);
  assert.match(result.text, /麦当劳实时价 token 已绑定/);
  assert.doesNotMatch(result.text, /secret-token/);
});

test("returns safe guidance when no McDonald's token is present", async () => {
  const result = await bindMcdTokenFromMessage(
    {
      message: "绑定麦当劳 token 但是这里没有真正 token",
      tokenPath: "mcd.token",
      configPath: "config.json"
    },
    {
      mkdir: async () => {
        throw new Error("should not write");
      }
    }
  );

  assert.equal(result.ok, false);
  assert.match(result.text, /没有识别到麦当劳 MCP token/);
  assert.match(result.text, /open\.mcd\.cn\/mcp/);
});
