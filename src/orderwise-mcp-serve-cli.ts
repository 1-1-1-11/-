import { runOrderWiseServeCli } from "./orderwise-mcp-serve.js";

try {
  process.exitCode = await runOrderWiseServeCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
