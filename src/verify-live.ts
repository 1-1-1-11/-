import { runVerifyLiveCli } from "./verify-live-cli.js";

try {
  const result = await runVerifyLiveCli(process.argv.slice(2));
  console.log(result.text);
  process.exitCode = result.exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
