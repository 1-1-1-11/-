import { runLuckinEnableCli } from "./luckin-mcp-enable.js";

try {
  const result = await runLuckinEnableCli(process.argv.slice(2));
  process.stdout.write(result.text);
  process.exitCode = result.exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
