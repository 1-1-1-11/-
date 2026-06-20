import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";

export interface OrderWiseServeOptions {
  repoPath: string;
  pythonPath: string;
  adbPath?: string;
}

export function parseOrderWiseServeArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): OrderWiseServeOptions {
  const repoPath = env.ORDERWISE_CLI_PATH ?? ".runtime/orderwise-agent";
  const options: OrderWiseServeOptions = {
    repoPath,
    pythonPath: env.ORDERWISE_PYTHON_PATH ?? defaultPythonPath(repoPath),
    adbPath: env.MEITUAN_ADB_PATH ?? env.ORDERWISE_ADB_PATH
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
    if (arg === "--adb") {
      options.adbPath = requireValue(arg, next);
      index += 1;
    }
  }

  return options;
}

export async function runOrderWiseServeCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const options = parseOrderWiseServeArgs(args, env);
  const repoPath = resolve(options.repoPath);
  const pythonPath = resolve(options.pythonPath);
  await assertFile(pythonPath, [
    `未找到 Python 虚拟环境: ${pythonPath}`,
    "可运行: py -3 -m venv .runtime\\orderwise-agent\\.venv",
    "然后: .runtime\\orderwise-agent\\.venv\\Scripts\\python.exe -m pip install -e .runtime\\orderwise-agent"
  ]);
  await assertFile(join(repoPath, "mcp_mode", "mcp_server", "order_wise_mcp_server.py"), [
    `未找到 OrderWise MCP server: ${repoPath}`,
    "可运行: git clone --depth 1 https://github.com/ucloud/orderwise-agent.git .runtime\\orderwise-agent"
  ]);

  const adbPath = options.adbPath ?? wingetAdbCandidate(env);
  const nextEnv = adbPath
    ? {
        ...env,
        PATH: `${dirname(adbPath)}${delimiter}${env.PATH ?? ""}`,
        Path: `${dirname(adbPath)}${delimiter}${env.Path ?? env.PATH ?? ""}`
      }
    : env;

  const child = spawn(pythonPath, ["-m", "mcp_mode.mcp_server.order_wise_mcp_server"], {
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
