import { runVerifyLiveCli, type VerifyLiveCliResult } from "./verify-live-cli.js";

export interface LiveNextActionCliOptions {
  commandOnly: boolean;
  includeAll: boolean;
  outputFormat: "text" | "json";
  verifyArgs: string[];
}

export interface LiveNextActionCliResult {
  text: string;
  exitCode: number;
  verifyResult: VerifyLiveCliResult;
}

export interface LiveNextActionCliDeps {
  runVerifyLiveCli?: (args: string[]) => Promise<VerifyLiveCliResult>;
}

const NEXT_ACTION_FLAGS = new Set(["--all", "--command-only", "--json"]);

export function parseLiveNextActionCliArgs(args: string[]): LiveNextActionCliOptions {
  return {
    commandOnly: args.includes("--command-only"),
    includeAll: args.includes("--all"),
    outputFormat: args.includes("--json") ? "json" : "text",
    verifyArgs: args.filter((arg) => !NEXT_ACTION_FLAGS.has(arg))
  };
}

export async function runLiveNextActionCli(
  args: string[],
  deps: LiveNextActionCliDeps = {}
): Promise<LiveNextActionCliResult> {
  const options = parseLiveNextActionCliArgs(args);
  const verifyResult = await (deps.runVerifyLiveCli ?? runVerifyLiveCli)(options.verifyArgs);

  return {
    text: formatNextActionOutput(verifyResult, options),
    exitCode: determineExitCode(verifyResult, options),
    verifyResult
  };
}

function formatNextActionOutput(
  verifyResult: VerifyLiveCliResult,
  options: LiveNextActionCliOptions
): string {
  const actions = options.includeAll
    ? verifyResult.report.actions
    : verifyResult.report.actions.slice(0, 1);

  if (options.commandOnly) {
    return actions[0]?.command ? `${actions[0].command}\n` : "";
  }

  if (options.outputFormat === "json") {
    return `${JSON.stringify({ status: verifyResult.report.status, actions }, null, 2)}\n`;
  }

  if (actions.length === 0) {
    const suffix = verifyResult.report.status === "pass" ? "remaining" : "available";
    return [
      `No live readiness actions ${suffix}.`,
      `Status: ${verifyResult.report.status.toUpperCase()}`
    ].join("\n") + "\n";
  }

  const lines = [
    options.includeAll ? "Live readiness actions:" : "Next live readiness action:",
    `Status: ${verifyResult.report.status.toUpperCase()}`
  ];
  for (const [index, action] of actions.entries()) {
    const prefix = options.includeAll ? `${index + 1}. ` : "";
    lines.push(`${prefix}${action.label}`);
    lines.push(`id: ${action.id}`);
    if (action.command) {
      lines.push(`command: ${action.command}`);
    }
    lines.push(`reason: ${action.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

function determineExitCode(
  verifyResult: VerifyLiveCliResult,
  options: LiveNextActionCliOptions
): number {
  if (options.commandOnly && !verifyResult.report.actions[0]?.command) {
    return 1;
  }
  if (verifyResult.report.actions.length > 0) {
    return 0;
  }
  return verifyResult.exitCode;
}
