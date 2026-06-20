import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("installer wires the OpenClaw network preload into gateway and login commands", async () => {
  const script = await readFile("scripts/install-openclaw-wechat.ps1", "utf8");

  assert.match(script, /openclaw-network-preload\.mjs/);
  assert.match(script, /OPENCLAW_WEIXIN_NODE_OPTIONS/);
  assert.match(script, /NODE_OPTIONS/);
  assert.match(script, /AbsoluteUri/);
  assert.match(script, /Ensure-CoffeeToolWorkspaceNotes/);
  assert.match(script, /coffee_price_search/);
  assert.doesNotMatch(script, /npm install -g openclaw/);
});

test("network preload pins Weixin iLink DNS through undici", async () => {
  const preload = await readFile("scripts/openclaw-network-preload.mjs", "utf8");

  assert.match(preload, /setGlobalDispatcher/);
  assert.match(preload, /ilinkai\.weixin\.qq\.com/);
  assert.match(preload, /43\.163\.179\.90/);
  assert.match(preload, /43\.163\.165\.187/);
});

test("Weixin login helper starts OpenClaw login with the same preload", async () => {
  const script = await readFile("scripts/start-weixin-login.ps1", "utf8");

  assert.match(script, /openclaw-network-preload\.mjs/);
  assert.match(script, /NODE_OPTIONS/);
  assert.match(script, /channels login --channel openclaw-weixin/);
});
