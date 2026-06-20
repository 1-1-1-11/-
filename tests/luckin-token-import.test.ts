import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  extractLuckinToken,
  importLuckinToken,
  parseLuckinTokenImportArgs,
  runLuckinTokenImportCli
} from "../src/luckin-token-import.js";

test("extracts Luckin token from common platform copy formats", () => {
  assert.equal(extractLuckinToken("raw-token-1234567890"), "raw-token-1234567890");
  assert.equal(extractLuckinToken("Authorization: Bearer bearer-token-1234567890"), "bearer-token-1234567890");
  assert.equal(extractLuckinToken("LUCKIN_MCP_TOKEN=env-token-1234567890"), "env-token-1234567890");
  assert.equal(extractLuckinToken("--token cli-token-1234567890"), "cli-token-1234567890");
  assert.equal(
    extractLuckinToken(
      JSON.stringify({
        mcpServers: {
          "my-coffee": {
            headers: {
              Authorization: "Bearer nested-token-1234567890"
            }
          }
        }
      })
    ),
    "nested-token-1234567890"
  );
});

test("parses Luckin token import CLI options", () => {
  const parsed = parseLuckinTokenImportArgs(
    ["--token-file", "token.txt", "--config", "config.json", "--enable", "--token", "abc1234567890123"],
    {}
  );

  assert.equal(parsed.tokenPath, "token.txt");
  assert.equal(parsed.configPath, "config.json");
  assert.equal(parsed.enable, true);
  assert.equal(parsed.tokenText, "abc1234567890123");
});

test("imports token from stdin without printing token value", async () => {
  let writtenPath = "";
  let writtenContent = "";
  const result = await runLuckinTokenImportCli(["--token-file", "token.txt"], {
    stdin: "Authorization: Bearer secret-token-1234567890",
    mkdir: async () => undefined,
    writeFile: async (path, content) => {
      writtenPath = path;
      writtenContent = content;
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(writtenPath, "token.txt");
  assert.equal(writtenContent, "secret-token-1234567890\n");
  assert.doesNotMatch(result.text, /secret-token/);
  assert.match(result.text, /已保存瑞幸 token/);
});

test("imports token and enables Luckin MCP when requested", async () => {
  let enabledPath = "";
  const result = await importLuckinToken(
    {
      tokenText: "token-1234567890abcdef",
      tokenPath: "token.txt",
      configPath: "config.json",
      enable: true
    },
    {
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      enableLuckinMcp: async (options) => {
        enabledPath = options.configPath;
        return {
          configPath: options.configPath,
          changed: true,
          text: "enabled"
        };
      }
    }
  );

  assert.equal(enabledPath, "config.json");
  assert.equal(result.enabled, true);
});

test("fails clearly when no token can be extracted", async () => {
  const result = await runLuckinTokenImportCli([], {
    stdin: "no token here"
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /没有从输入中识别到 token/);
});

test("package exposes Luckin token import script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["luckin:import-token"], /luckin-token-import-cli\.ts/);
});
