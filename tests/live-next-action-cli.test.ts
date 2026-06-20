import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseLiveNextActionCliArgs,
  runLiveNextActionCli
} from "../src/live-next-action-cli.js";
import type { VerifyLiveCliResult } from "../src/verify-live-cli.js";

const failingVerifyResult: VerifyLiveCliResult = {
  exitCode: 1,
  text: "",
  report: {
    status: "fail",
    checks: [],
    actions: [
      {
        id: "weixin-login",
        label: "完成微信扫码登录",
        reason: "微信 channel 尚未完成扫码登录",
        command: "npm run weixin:login -- --open-qr --qr-url-file .runtime/weixin-login/qr-url.txt"
      },
      {
        id: "batch-calibrate",
        label: "批量写入真实平台 URL",
        reason: "多个启用渠道仍是 example.com 占位 URL",
        command: "npm run capture:calibrate -- \"查公司附近冰美式\" --url-meituan \"<real-meituan-url>\" --manual-ms 120000"
      }
    ]
  }
};

test("parses next-action CLI options and keeps verify args", () => {
  const parsed = parseLiveNextActionCliArgs([
    "--ignore-calibration-report",
    "--command-only",
    "--all",
    "--json"
  ]);

  assert.equal(parsed.commandOnly, true);
  assert.equal(parsed.includeAll, true);
  assert.equal(parsed.outputFormat, "json");
  assert.deepEqual(parsed.verifyArgs, ["--ignore-calibration-report"]);
});

test("next-action CLI prints the first action command only", async () => {
  let verifyArgs: string[] | undefined;
  const result = await runLiveNextActionCli(["--ignore-calibration-report", "--command-only"], {
    runVerifyLiveCli: async (args) => {
      verifyArgs = args;
      return failingVerifyResult;
    }
  });

  assert.deepEqual(verifyArgs, ["--ignore-calibration-report"]);
  assert.equal(result.exitCode, 0);
  assert.equal(
    result.text,
    "npm run weixin:login -- --open-qr --qr-url-file .runtime/weixin-login/qr-url.txt\n"
  );
});

test("next-action CLI can emit all actions as JSON", async () => {
  const result = await runLiveNextActionCli(["--all", "--json"], {
    runVerifyLiveCli: async () => failingVerifyResult
  });
  const parsed = JSON.parse(result.text) as {
    status: string;
    actions: Array<{ id: string; command?: string }>;
  };

  assert.equal(result.exitCode, 0);
  assert.equal(parsed.status, "fail");
  assert.deepEqual(
    parsed.actions.map((action) => action.id),
    ["weixin-login", "batch-calibrate"]
  );
});

test("next-action CLI reports when no actions remain", async () => {
  const result = await runLiveNextActionCli([], {
    runVerifyLiveCli: async () => ({
      exitCode: 0,
      text: "",
      report: { status: "pass", checks: [], actions: [] }
    })
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /No live readiness actions remaining/);
  assert.match(result.text, /Status: PASS/);
});

test("package exposes live next-action script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["verify:next"], /live-next-action\.ts/);
});
