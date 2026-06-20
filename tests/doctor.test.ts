import assert from "node:assert/strict";
import test from "node:test";

import { buildDoctorReport, formatDoctorReport, getOpenClawInvocation } from "../src/doctor.js";

test("doctor report fails on mojibake config paths, unconfigured Weixin, and iLink TLS errors", () => {
  const report = buildDoctorReport({
    openclawConfig: {
      coffeeConfigPath: "D:\\Desktop\\鑷姩鏌ヤ环\\config\\coffee-price.config.json",
      meituanSnapshotPath: "D:\\Desktop\\鑷姩鏌ヤ环\\config\\snapshots\\meituan.json",
      dmScope: undefined,
      weixinEnabled: true
    },
    pathExists: {},
    gatewayStatusText:
      "Runtime: running\nConnectivity probe: ok\nListening: 127.0.0.1:18789\n",
    gatewayWrapperText: "@echo off\nset \"NODE_OPTIONS=--import=file:///C:/Users/32299/.openclaw/coffee-price-project/scripts/openclaw-network-preload.mjs\"\n",
    weixinCapabilitiesText:
      "openclaw-weixin default\nSupport: chatTypes=direct media blockStreaming\nStatus: not configured, enabled\n",
    ilinkProbe: {
      ok: false,
      error: "Client network socket disconnected before secure TLS connection was established",
      code: "ECONNRESET"
    }
  });

  assert.equal(report.status, "fail");
  assert.equal(report.checks.find((check) => check.id === "gateway")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "gateway-preload")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "coffee-config-path")?.status, "fail");
  assert.equal(report.checks.find((check) => check.id === "weixin-login")?.status, "fail");
  assert.match(report.checks.find((check) => check.id === "weixin-login")?.detail ?? "", /openclaw channels login --channel openclaw-weixin/);
  assert.match(report.checks.find((check) => check.id === "weixin-login")?.detail ?? "", /npm run weixin:login/);
  assert.equal(report.checks.find((check) => check.id === "ilink-tls")?.status, "fail");
  assert.match(formatDoctorReport(report), /ECONNRESET/);
});

test("doctor report passes when runtime paths, Weixin login, and iLink TLS are healthy", () => {
  const coffeeConfigPath = "C:\\Users\\32299\\.openclaw\\coffee-price-project\\config\\coffee-price.config.json";
  const snapshotPath = "C:\\Users\\32299\\.openclaw\\coffee-price-project\\config\\snapshots\\meituan.json";
  const priceBookPath = "C:\\Users\\32299\\.openclaw\\coffee-price-project\\config\\pricebook.json";

  const report = buildDoctorReport({
    openclawConfig: {
      coffeeConfigPath,
      meituanSnapshotPath: snapshotPath,
      priceBookEnabled: true,
      priceBookPath,
      dmScope: "per-account-channel-peer",
      weixinEnabled: true
    },
    pathExists: {
      [coffeeConfigPath]: true,
      [snapshotPath]: true,
      [priceBookPath]: true
    },
    gatewayStatusText:
      "Runtime: running\nConnectivity probe: ok\nListening: 127.0.0.1:18789\n",
    gatewayWrapperText: "@echo off\nset \"NODE_OPTIONS=--import=file:///C:/Users/32299/.openclaw/coffee-price-project/scripts/openclaw-network-preload.mjs\"\n",
    weixinCapabilitiesText:
      "openclaw-weixin default\nSupport: chatTypes=direct media blockStreaming\nStatus: configured, enabled\n",
    ilinkProbe: { ok: true, status: 200 }
  });

  assert.equal(report.status, "pass");
  assert.equal(report.checks.every((check) => check.status === "pass"), true);
  assert.match(formatDoctorReport(report), /总体: PASS/);
});

test("doctor report treats indexed Weixin account capability output as logged in", () => {
  const coffeeConfigPath = "C:\\Users\\32299\\.openclaw\\coffee-price-project\\config\\coffee-price.config.json";
  const snapshotPath = "C:\\Users\\32299\\.openclaw\\coffee-price-project\\config\\snapshots\\meituan.json";
  const priceBookPath = "C:\\Users\\32299\\.openclaw\\coffee-price-project\\config\\pricebook.json";

  const report = buildDoctorReport({
    openclawConfig: {
      coffeeConfigPath,
      meituanSnapshotPath: snapshotPath,
      priceBookEnabled: true,
      priceBookPath,
      dmScope: "per-account-channel-peer",
      weixinEnabled: true
    },
    pathExists: {
      [coffeeConfigPath]: true,
      [snapshotPath]: true,
      [priceBookPath]: true
    },
    gatewayStatusText:
      "Runtime: running\nConnectivity probe: ok\nListening: 127.0.0.1:18789\n",
    gatewayWrapperText: "@echo off\nset \"NODE_OPTIONS=--import=file:///C:/Users/32299/.openclaw/coffee-price-project/scripts/openclaw-network-preload.mjs\"\n",
    weixinCapabilitiesText:
      "openclaw-weixin b59af4803859-im-bot\nSupport: chatTypes=direct media blockStreaming\nActions: send, broadcast\nProbe: unavailable\n",
    ilinkProbe: { ok: true, status: 404 }
  });

  assert.equal(report.checks.find((check) => check.id === "weixin-login")?.status, "pass");
  assert.equal(report.status, "pass");
});

test("doctor invokes OpenClaw through Node instead of a Windows cmd shim", () => {
  const invocation = getOpenClawInvocation("D:\\Desktop\\自动查价", "win32", ["gateway", "status"]);

  assert.match(invocation.file, /node(\.exe)?$/i);
  assert.equal(invocation.args[0], "D:\\Desktop\\自动查价\\node_modules\\openclaw\\openclaw.mjs");
  assert.deepEqual(invocation.args.slice(1), ["gateway", "status"]);
});
