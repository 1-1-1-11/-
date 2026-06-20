import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  enableLuckinMcp,
  parseLuckinEnableArgs,
  runLuckinEnableCli
} from "../src/luckin-mcp-enable.js";

test("parses Luckin enable CLI options", () => {
  const parsed = parseLuckinEnableArgs(["--config", "config/local.json", "--dry-run"]);

  assert.equal(parsed.configPath, "config/local.json");
  assert.equal(parsed.dryRun, true);
});

test("enables an existing disabled Luckin MCP source without touching token fields", async () => {
  let written = "";
  const result = await enableLuckinMcp(
    { configPath: "config.json", dryRun: false },
    {
      readFile: async () =>
        JSON.stringify({
          externalSources: [
            {
              id: "luckinMcp",
              label: "瑞幸官方 MCP",
              enabled: false,
              command: "node",
              args: ["--import", "tsx", "src/luckin-mcp-source-cli.ts"],
              timeoutMs: 45000
            }
          ]
        }),
      writeFile: async (_path, content) => {
        written = content;
      }
    }
  );

  assert.equal(result.changed, true);
  const next = JSON.parse(written);
  assert.equal(next.externalSources[0].enabled, true);
  assert.equal("token" in next.externalSources[0], false);
});

test("adds Luckin MCP source when it is missing", async () => {
  let written = "";
  await runLuckinEnableCli(["--config", "config.json"], {
    readFile: async () => JSON.stringify({ externalSources: [] }),
    writeFile: async (_path, content) => {
      written = content;
    }
  });

  const next = JSON.parse(written);
  assert.equal(next.externalSources[0].id, "luckinMcp");
  assert.equal(next.externalSources[0].enabled, true);
});

test("dry-run reports pending change without writing", async () => {
  let wrote = false;
  const result = await runLuckinEnableCli(["--config", "config.json", "--dry-run"], {
    readFile: async () => JSON.stringify({ externalSources: [] }),
    writeFile: async () => {
      wrote = true;
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.changed, true);
  assert.equal(wrote, false);
  assert.match(result.text, /将启用 luckinMcp/);
});

test("package exposes Luckin enable script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["luckin:enable"], /luckin-mcp-enable-cli\.ts/);
});
