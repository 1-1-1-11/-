import assert from "node:assert/strict";
import test from "node:test";

import { parseCaptureCliArgs } from "../src/capture-cli.js";

test("parses capture CLI options and default output paths", () => {
  const parsed = parseCaptureCliArgs([
    "查公司附近冰美式",
    "--source",
    "meituan",
    "--config",
    "config/coffee-price.config.json",
    "--manual-ms",
    "120000"
  ]);

  assert.equal(parsed.message, "查公司附近冰美式");
  assert.equal(parsed.source, "meituan");
  assert.equal(parsed.configPath, "config/coffee-price.config.json");
  assert.equal(parsed.htmlPath, ".runtime/captures/meituan.html");
  assert.equal(parsed.snapshotPath, ".runtime/captures/meituan.snapshot.json");
  assert.equal(parsed.auditPath, ".runtime/captures/meituan.audit.json");
  assert.equal(parsed.networkPath, ".runtime/captures/meituan.network.json");
  assert.equal(parsed.manualWaitMs, 120000);
  assert.equal(parsed.entryUrlOverride, undefined);
});

test("parses capture CLI network log override", () => {
  const parsed = parseCaptureCliArgs([
    "查公司附近冰美式",
    "--source",
    "meituan",
    "--network",
    ".runtime/captures/meituan-debug.network.json"
  ]);

  assert.equal(parsed.networkPath, ".runtime/captures/meituan-debug.network.json");
});

test("parses capture CLI entry URL override", () => {
  const parsed = parseCaptureCliArgs([
    "查公司附近冰美式",
    "--source",
    "meituan",
    "--url",
    "https://example.com/manual"
  ]);

  assert.equal(parsed.entryUrlOverride, "https://example.com/manual");
});

test("parses capture CLI save-url option with explicit URL override", () => {
  const parsed = parseCaptureCliArgs([
    "查公司附近冰美式",
    "--source",
    "meituan",
    "--url",
    "https://example.com/manual",
    "--save-url"
  ]);

  assert.equal(parsed.entryUrlOverride, "https://example.com/manual");
  assert.equal(parsed.saveEntryUrl, true);
});

test("rejects save-url when no explicit URL override is provided", () => {
  assert.throws(
    () => parseCaptureCliArgs(["查公司附近冰美式", "--source", "meituan", "--save-url"]),
    /--save-url requires --url/
  );
});

test("rejects unsupported capture sources", () => {
  assert.throws(
    () => parseCaptureCliArgs(["查公司附近冰美式", "--source", "douyin"]),
    /不支持的渠道/
  );
});
