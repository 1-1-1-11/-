import { runCaptureCli } from "./capture-cli.js";

try {
  console.log(await runCaptureCli(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
