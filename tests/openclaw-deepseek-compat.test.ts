import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyOpenClawDeepSeekCompat } from "../src/openclaw-deepseek-compat.js";

test("deepseek compat narrows plugins and disables memory-core", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-deepseek-compat-"));
  const configPath = join(dir, "openclaw.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        plugins: {
          allow: [],
          entries: {
            "coffee-price": { enabled: true, config: { configPath: "config/coffee-price.config.json" } },
            "openclaw-weixin": { enabled: true },
            deepseek: { enabled: true },
            "memory-core": { enabled: true },
            browser: { enabled: true }
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const result = await applyOpenClawDeepSeekCompat({ configPath });
  const written = JSON.parse(await readFile(configPath, "utf8")) as {
    plugins: { allow: string[]; entries: Record<string, { enabled?: boolean }> };
  };

  assert.equal(result.changed, true);
  assert.deepEqual(written.plugins.allow, ["coffee-price", "openclaw-weixin", "deepseek"]);
  assert.equal(written.plugins.entries["memory-core"].enabled, false);
  assert.equal(written.plugins.entries.browser.enabled, true);
});

test("deepseek compat dry-run reports change without writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-deepseek-compat-dry-"));
  const configPath = join(dir, "openclaw.json");
  const original = JSON.stringify({ plugins: { allow: [], entries: {} } }, null, 2);
  await writeFile(configPath, original, "utf8");

  const result = await applyOpenClawDeepSeekCompat({ configPath, dryRun: true });
  const after = await readFile(configPath, "utf8");

  assert.equal(result.changed, true);
  assert.equal(after, original);
});
