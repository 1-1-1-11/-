import { runLuckinOfficialCli } from "./luckin-official-cli.js";

const result = await runLuckinOfficialCli(process.argv.slice(2));
process.stdout.write(result.text);
process.exitCode = result.exitCode;
