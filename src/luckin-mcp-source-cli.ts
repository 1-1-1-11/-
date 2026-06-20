import { runLuckinMcpSourceCli } from "./luckin-mcp-source.js";

const result = await runLuckinMcpSourceCli(process.argv.slice(2));
process.stdout.write(result.text);
process.exitCode = result.exitCode;
