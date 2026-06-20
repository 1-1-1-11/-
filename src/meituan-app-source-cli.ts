import { runMeituanAppSourceCli } from "./meituan-app-source.js";

const result = await runMeituanAppSourceCli(process.argv.slice(2));
process.stdout.write(result.text);
process.exitCode = result.exitCode;
