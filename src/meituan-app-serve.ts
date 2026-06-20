import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";

export interface MeituanServeOptions {
  repoPath: string;
  pythonPath: string;
  port: string;
  adbPath?: string;
}

export function parseMeituanServeArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): MeituanServeOptions {
  const repoPath = env.MEITUAN_CLI_PATH ?? ".runtime/meituan-cli";
  const options: MeituanServeOptions = {
    repoPath,
    pythonPath: env.MEITUAN_PYTHON_PATH ?? defaultPythonPath(repoPath),
    port: env.MEITUAN_APP_PORT ?? "18080",
    adbPath: env.MEITUAN_ADB_PATH
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--repo") {
      options.repoPath = requireValue(arg, next);
      options.pythonPath = defaultPythonPath(options.repoPath);
      index += 1;
      continue;
    }
    if (arg === "--python") {
      options.pythonPath = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--port") {
      options.port = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--adb") {
      options.adbPath = requireValue(arg, next);
      index += 1;
    }
  }

  return options;
}

export async function runMeituanServeCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const options = parseMeituanServeArgs(args, env);
  const repoPath = resolve(options.repoPath);
  const pythonPath = resolve(options.pythonPath);
  const cliPath = join(repoPath, "cli.py");

  await assertFile(cliPath, [
    `未找到 meituan-cli: ${cliPath}`,
    "可运行: git clone --depth 1 https://github.com/oscarka/meituan-cli.git .runtime\\meituan-cli"
  ]);
  await assertFile(pythonPath, [
    `未找到 Python 虚拟环境: ${pythonPath}`,
    "可运行: py -3 -m venv .runtime\\meituan-cli\\.venv",
    "然后: .runtime\\meituan-cli\\.venv\\Scripts\\python.exe -m pip install uiautomator2 requests"
  ]);

  const adbPath = options.adbPath ?? wingetAdbCandidate(env);
  const nextEnv = adbPath
    ? {
        ...env,
        PATH: `${dirname(adbPath)}${delimiter}${env.PATH ?? ""}`,
        Path: `${dirname(adbPath)}${delimiter}${env.Path ?? env.PATH ?? ""}`
      }
    : env;

  const child = spawn(pythonPath, [cliPath, "serve", "--port", options.port], {
    cwd: repoPath,
    env: nextEnv,
    stdio: "inherit",
    windowsHide: false
  });

  return await new Promise<number>((resolveExit) => {
    child.once("exit", (code) => resolveExit(code ?? 0));
    child.once("error", (error) => {
      console.error(error.message);
      resolveExit(1);
    });
  });
}

function defaultPythonPath(repoPath: string): string {
  return process.platform === "win32"
    ? join(repoPath, ".venv", "Scripts", "python.exe")
    : join(repoPath, ".venv", "bin", "python");
}

function wingetAdbCandidate(env: NodeJS.ProcessEnv): string | undefined {
  if (!env.LOCALAPPDATA) {
    return undefined;
  }
  return join(
    env.LOCALAPPDATA,
    "Microsoft",
    "WinGet",
    "Packages",
    "Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "platform-tools",
    process.platform === "win32" ? "adb.exe" : "adb"
  );
}

async function assertFile(path: string, lines: string[]): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(lines.join("\n"));
  }
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} 缺少参数值`);
  }
  return value;
}
