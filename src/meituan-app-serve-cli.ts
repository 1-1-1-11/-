import { runMeituanServeCli } from "./meituan-app-serve.js";

try {
  process.exitCode = await runMeituanServeCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
