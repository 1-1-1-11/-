import { runLuckinLoginCli } from "./luckin-login.js";

const result = await runLuckinLoginCli(process.argv.slice(2));
process.stdout.write(result.text);
process.exitCode = result.exitCode;
