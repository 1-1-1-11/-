import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

import {
  parseLuckinOfficialCliArgs,
  runLuckinOfficialCli,
  selectLuckinCliManifestFile,
  setupLuckinOfficialCli,
  type LuckinOfficialCliManifest
} from "../src/luckin-official-cli.js";

const archive = Buffer.from("official-cli-zip");
const archiveSha = createHash("sha256").update(archive).digest("hex");

const manifest: LuckinOfficialCliManifest = {
  latest: "0.0.1",
  files: [
    {
      os: "windows",
      arch: "amd64",
      url: "https://example.com/luckin.zip",
      sha256: archiveSha
    },
    {
      os: "darwin",
      arch: "arm64",
      url: "https://example.com/luckin.tar.gz"
    }
  ]
};

test("parses official Luckin CLI setup options", () => {
  const parsed = parseLuckinOfficialCliArgs([
    "--manifest-url",
    "https://example.com/manifest.json",
    "--install-dir",
    ".runtime/luckin-test",
    "--config",
    "config/local.json",
    "--token-file",
    "token.txt",
    "--from-clipboard",
    "--login-timeout-ms",
    "12345",
    "--install-only",
    "--json"
  ]);

  assert.equal(parsed.manifestUrl, "https://example.com/manifest.json");
  assert.equal(parsed.installDir, ".runtime/luckin-test");
  assert.equal(parsed.configPath, "config/local.json");
  assert.equal(parsed.tokenPath, "token.txt");
  assert.equal(parsed.fromClipboard, true);
  assert.equal(parsed.loginTimeoutMs, 12345);
  assert.equal(parsed.installOnly, true);
  assert.equal(parsed.runLogin, false);
  assert.equal(parsed.enable, false);
  assert.equal(parsed.json, true);
});

test("parses official Luckin CLI options after npm script terminator", () => {
  const parsed = parseLuckinOfficialCliArgs(["--", "--install-only", "--json"]);

  assert.equal(parsed.installOnly, true);
  assert.equal(parsed.runLogin, false);
  assert.equal(parsed.enable, false);
  assert.equal(parsed.json, true);
});

test("selects the matching official CLI manifest file", () => {
  const selected = selectLuckinCliManifestFile(manifest, "win32", "x64");

  assert.equal(selected.os, "windows");
  assert.equal(selected.arch, "amd64");
  assert.equal(selected.url, "https://example.com/luckin.zip");
});

test("downloads official CLI, runs login, enables source, and checks doctor", async () => {
  const files = new Set<string>();
  const writes = new Map<string, Buffer>();
  const commands: Array<{ command: string; args: string[] }> = [];
  const result = await setupLuckinOfficialCli(
    {
      manifestUrl: "https://example.com/manifest.json",
      installDir: ".runtime/luckin-official-test",
      configPath: "config.json",
      installOnly: false,
      runLogin: true,
      enable: true,
      json: false
    },
    {
      cwd: "D:\\work",
      platform: "win32",
      arch: "x64",
      fetchText: async () => JSON.stringify(manifest),
      fetchBuffer: async () => archive,
      mkdir: async (path) => {
        files.add(path);
      },
      writeFile: async (path, content) => {
        const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
        writes.set(path, buffer);
        files.add(path);
      },
      readFile: async (path) => writes.get(path) ?? Buffer.from(""),
      existsSync: (path) => files.has(path),
      extractArchive: async (_archivePath, destinationPath, kind) => {
        assert.equal(kind, "zip");
        files.add(join(destinationPath, "luckin.exe"));
      },
      runCommand: async (command, args) => {
        commands.push({ command, args });
        return 0;
      },
      enableLuckinMcp: async (options) => ({
        configPath: options.configPath,
        changed: true,
        text: "enabled luckinMcp"
      }),
      runLuckinDoctor: async () => ({
        status: "pass",
        checks: [
          { id: "token", label: "瑞幸 token", status: "pass", message: "ok" },
          { id: "external-source", label: "luckinMcp", status: "pass", message: "ok" }
        ]
      })
    }
  );

  assert.equal(result.install.downloaded, true);
  assert.equal(result.install.version, "0.0.1");
  assert.deepEqual(commands, [{ command: result.install.executablePath, args: ["login"] }]);
  assert.equal(result.enable?.changed, true);
  assert.equal(result.doctor?.status, "pass");
  assert.match(result.text, /瑞幸官方 CLI 已可用于实时自取价/);
});

test("official CLI login timeout returns clipboard fallback guidance", async () => {
  const files = new Set<string>();
  const result = await setupLuckinOfficialCli(
    {
      manifestUrl: "https://example.com/manifest.json",
      installDir: ".runtime/luckin-official-test",
      configPath: "config.json",
      installOnly: false,
      runLogin: true,
      enable: true,
      json: false
    },
    {
      cwd: "D:\\work",
      platform: "win32",
      arch: "x64",
      fetchText: async () => JSON.stringify(manifest),
      fetchBuffer: async () => archive,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      readFile: async () => archive,
      existsSync: (path) => files.has(path),
      extractArchive: async (_archivePath, destinationPath) => {
        files.add(join(destinationPath, "luckin.exe"));
      },
      runCommand: async () => 124
    }
  );

  assert.equal(result.loginExitCode, 124);
  assert.match(result.text, /登录未完成或超时/);
  assert.match(result.text, /luckin:official-login -- --from-clipboard/);
});

test("official CLI setup can import a copied token without running login", async () => {
  const files = new Set<string>();
  const imported: Array<{ tokenText?: string; fromClipboard?: boolean; enable: boolean }> = [];
  const commands: Array<{ command: string; args: string[] }> = [];
  const result = await setupLuckinOfficialCli(
    {
      manifestUrl: "https://example.com/manifest.json",
      installDir: ".runtime/luckin-official-test",
      configPath: "config.json",
      tokenText: "Authorization: Bearer copied-token-1234567890",
      tokenPath: "token.txt",
      fromClipboard: false,
      installOnly: false,
      runLogin: true,
      enable: true,
      json: false
    },
    {
      cwd: "D:\\work",
      platform: "win32",
      arch: "x64",
      fetchText: async () => JSON.stringify(manifest),
      fetchBuffer: async () => archive,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      readFile: async () => archive,
      existsSync: (path) => files.has(path),
      extractArchive: async (_archivePath, destinationPath) => {
        files.add(join(destinationPath, "luckin.exe"));
      },
      runCommand: async (command, args) => {
        commands.push({ command, args });
        return 0;
      },
      importLuckinToken: async (options) => {
        imported.push({
          tokenText: options.tokenText,
          fromClipboard: options.fromClipboard,
          enable: options.enable
        });
        return {
          tokenPath: options.tokenPath,
          enabled: options.enable,
          text: "saved token"
        };
      },
      runLuckinDoctor: async () => ({
        status: "pass",
        checks: [{ id: "token", label: "瑞幸 token", status: "pass", message: "ok" }]
      })
    }
  );

  assert.deepEqual(commands, []);
  assert.deepEqual(imported, [
    {
      tokenText: "Authorization: Bearer copied-token-1234567890",
      fromClipboard: false,
      enable: true
    }
  ]);
  assert.equal(result.doctor?.status, "pass");
  assert.match(result.text, /已导入瑞幸官方 token/);
});

test("official CLI setup fails on checksum mismatch", async () => {
  const result = await runLuckinOfficialCli(["--install-only"], {
    platform: "win32",
    arch: "x64",
    fetchText: async () => JSON.stringify(manifest),
    fetchBuffer: async () => Buffer.from("tampered"),
    mkdir: async () => undefined,
    existsSync: () => false
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /校验失败/);
});

test("package exposes official Luckin login script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(pkg.scripts["luckin:official-login"], /luckin-official-cli-runner\.ts/);
});
