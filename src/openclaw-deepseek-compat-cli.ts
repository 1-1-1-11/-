import {
  applyOpenClawDeepSeekCompat,
  formatOpenClawDeepSeekCompatResult
} from "./openclaw-deepseek-compat.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const dryRun = args.includes("--dry-run");
const configPath = readOption(args, "--config");

try {
  const result = await applyOpenClawDeepSeekCompat({ configPath, dryRun });
  console.log(json ? JSON.stringify(result, null, 2) : formatOpenClawDeepSeekCompatResult(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
