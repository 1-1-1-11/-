import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { bindMcpSourceFromMessage } from "../src/mcp-source-bind.js";
import type { GenericMcpSetupOptions } from "../src/generic-mcp-setup.js";

test("binds a generic HTTP MCP price source from a private message without echoing the token", async () => {
  let writtenPath = "";
  let writtenContent = "";
  const captured: { setupOptions?: GenericMcpSetupOptions } = {};

  const result = await bindMcpSourceFromMessage(
    {
      message:
        "接入MCP id coffeeLive label 实时咖啡 MCP endpoint https://example.com/mcp tool coffee_price_search token Authorization: Bearer secret-token-1234567890",
      configPath: "config.json",
      tokenDir: "tokens"
    },
    {
      mkdir: async () => undefined,
      writeFile: async (path, content) => {
        writtenPath = path;
        writtenContent = content;
      },
      setupGenericMcpSource: async (options) => {
        captured.setupOptions = options;
        return {
          status: "warn",
          configPath: options.configPath,
          changed: true,
          dryRun: false,
          source: {
            id: options.id,
            enabled: true,
            type: "mcp",
            transport: "http",
            endpoint: options.endpoint,
            toolName: options.toolName,
            bearerTokenFile: options.bearerTokenFile
          },
          checks: []
        };
      }
    }
  );

  assert.equal(writtenPath, join("tokens", "coffeeLive.token"));
  assert.equal(writtenContent, "secret-token-1234567890\n");
  assert.equal(captured.setupOptions?.id, "coffeeLive");
  assert.equal(captured.setupOptions?.label, "实时咖啡 MCP");
  assert.equal(captured.setupOptions?.endpoint, "https://example.com/mcp");
  assert.equal(captured.setupOptions?.toolName, "coffee_price_search");
  assert.equal(captured.setupOptions?.bearerTokenFile, join("tokens", "coffeeLive.token"));
  assert.equal(captured.setupOptions?.probeCall, false);
  assert.equal(result.ok, true);
  assert.match(result.text, /已接入 MCP 查价源/);
  assert.match(result.text, /coffeeLive/);
  assert.doesNotMatch(result.text, /secret-token/);
});

test("returns safe guidance when endpoint or tool is missing", async () => {
  let wrote = false;
  const result = await bindMcpSourceFromMessage(
    {
      message: "接入MCP token Authorization: Bearer secret-token-1234567890",
      configPath: "config.json",
      tokenDir: "tokens"
    },
    {
      writeFile: async () => {
        wrote = true;
      },
      mkdir: async () => undefined
    }
  );

  assert.equal(wrote, false);
  assert.equal(result.ok, false);
  assert.match(result.text, /接入MCP endpoint https:\/\/example.com\/mcp tool coffee_price_search/);
  assert.doesNotMatch(result.text, /secret-token/);
});
