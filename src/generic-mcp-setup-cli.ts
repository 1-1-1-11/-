import { runGenericMcpSetupCli } from "./generic-mcp-setup.js";

runGenericMcpSetupCli(process.argv.slice(2)).then(({ text, exitCode }) => {
  process.stdout.write(text);
  process.exitCode = exitCode;
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
