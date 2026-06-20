import { runLuckinTokenImportCli } from "./luckin-token-import.js";

const result = await runLuckinTokenImportCli(process.argv.slice(2));
process.stdout.write(result.text);
process.exitCode = result.exitCode;
