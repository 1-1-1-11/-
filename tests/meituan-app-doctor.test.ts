import assert from "node:assert/strict";
import test from "node:test";
import { Response } from "undici";

import {
  formatMeituanDoctorReport,
  parseMeituanDoctorArgs,
  runMeituanDoctor,
  runMeituanDoctorCli,
  type ExecFileResult
} from "../src/meituan-app-doctor.js";
import { parseMeituanServeArgs } from "../src/meituan-app-serve.js";

test("parses Meituan doctor CLI options", () => {
  const parsed = parseMeituanDoctorArgs([
    "--config",
    "config/local.json",
    "--base-url",
    "http://127.0.0.1:19090",
    "--adb",
    "D:\\tools\\adb.exe",
    "--json"
  ], { MEITUAN_APP_BASE_URL: "http://127.0.0.1:18080" });

  assert.equal(parsed.configPath, "config/local.json");
  assert.equal(parsed.baseUrl, "http://127.0.0.1:19090");
  assert.equal(parsed.adbPath, "D:\\tools\\adb.exe");
  assert.equal(parsed.json, true);
});

test("passes when ADB, Android device, HTTP service, and config are ready", async () => {
  const report = await runMeituanDoctor({
    configPath: "config/coffee-price.config.json",
    baseUrl: "http://127.0.0.1:18080",
    adbPath: "adb",
    json: false
  }, {
    readFile: async () => JSON.stringify({
      externalSources: [{ id: "meituanApp", enabled: true }]
    }),
    execFile: async (_file, args): Promise<ExecFileResult> => {
      if (args[0] === "version") {
        return { stdout: "Android Debug Bridge version 1.0.41\n", stderr: "" };
      }
      return {
        stdout: "List of devices attached\nserial123\tdevice product:test model:Pixel\n",
        stderr: ""
      };
    },
    fetch: async () => new Response(JSON.stringify({ ok: true, page: "home" }), { status: 200 })
  });

  assert.equal(report.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "adb")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "android-device")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "service")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "external-source")?.status, "pass");
  assert.match(formatMeituanDoctorReport(report), /总体: PASS/);
});

test("fails clearly when no Android device and service are available", async () => {
  const report = await runMeituanDoctor({
    configPath: "config/coffee-price.config.json",
    baseUrl: "http://127.0.0.1:18080",
    adbPath: "adb",
    json: false
  }, {
    readFile: async () => JSON.stringify({
      externalSources: [{ id: "meituanApp", enabled: false }]
    }),
    execFile: async (_file, args): Promise<ExecFileResult> => {
      if (args[0] === "version") {
        return { stdout: "Android Debug Bridge version 1.0.41\n", stderr: "" };
      }
      return { stdout: "List of devices attached\n\n", stderr: "" };
    },
    fetch: async () => {
      throw new Error("ECONNREFUSED");
    }
  });

  assert.equal(report.status, "fail");
  assert.equal(report.checks.find((check) => check.id === "adb")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "android-device")?.status, "fail");
  assert.match(report.checks.find((check) => check.id === "android-device")?.message ?? "", /未检测到/);
  assert.equal(report.checks.find((check) => check.id === "service")?.status, "fail");
  assert.equal(report.checks.find((check) => check.id === "external-source")?.status, "warn");
});

test("CLI emits JSON and returns non-zero for failing Meituan doctor report", async () => {
  const result = await runMeituanDoctorCli(["--json", "--adb", "adb"], {
    readFile: async () => JSON.stringify({ externalSources: [] }),
    execFile: async (_file, args): Promise<ExecFileResult> => {
      if (args[0] === "version") {
        return { stdout: "Android Debug Bridge version 1.0.41\n", stderr: "" };
      }
      return { stdout: "List of devices attached\n\n", stderr: "" };
    },
    fetch: async () => {
      throw new Error("ECONNREFUSED");
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /"status": "fail"/);
  assert.match(result.text, /"externalSources.meituanApp"/);
});

test("package exposes Meituan doctor script", async () => {
  const pkg = await import("../package.json", { with: { type: "json" } });
  assert.match(pkg.default.scripts["meituan:doctor"], /meituan-app-doctor-cli\.ts/);
});

test("parses Meituan serve CLI options and exposes package script", async () => {
  const parsed = parseMeituanServeArgs([
    "--repo",
    ".runtime/mt",
    "--python",
    ".runtime/mt/.venv/Scripts/python.exe",
    "--port",
    "19090",
    "--adb",
    "D:\\tools\\adb.exe"
  ]);

  assert.equal(parsed.repoPath, ".runtime/mt");
  assert.equal(parsed.pythonPath, ".runtime/mt/.venv/Scripts/python.exe");
  assert.equal(parsed.port, "19090");
  assert.equal(parsed.adbPath, "D:\\tools\\adb.exe");

  const pkg = await import("../package.json", { with: { type: "json" } });
  assert.match(pkg.default.scripts["meituan:serve"], /meituan-app-serve-cli\.ts/);
});
