import { runLuckinOfficialSourceCli } from "./luckin-official-source.js";

const result = await runLuckinOfficialSourceCli(process.argv.slice(2));
process.stdout.write(result.text);
process.exitCode = result.exitCode;
