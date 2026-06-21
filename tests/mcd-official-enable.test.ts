import assert from "node:assert/strict";
import test from "node:test";

import { enableMcdOfficialSource } from "../src/mcd-official-enable.js";

test("adds and enables the McDonald's official MCP source", async () => {
  let written = "";
  const result = await enableMcdOfficialSource(
    { configPath: "config.json", dryRun: false },
    {
      readFile: async () => JSON.stringify({ externalSources: [] }),
      writeFile: async (_path, content) => {
        written = content;
      }
    }
  );

  assert.equal(result.changed, true);
  const next = JSON.parse(written);
  assert.equal(next.externalSources[0].id, "mcdOfficial");
  assert.equal(next.externalSources[0].enabled, true);
  assert.equal(next.externalSources[0].label, "麦当劳官方 MCP");
  assert.deepEqual(next.externalSources[0].args, ["--import", "tsx", "src/mcd-official-source-cli.ts"]);
  assert.equal(next.externalSources[0].timeoutMs, 120000);
});
