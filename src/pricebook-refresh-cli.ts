import { runPriceBookRefreshCli } from "./pricebook-refresh.js";

const result = await runPriceBookRefreshCli(process.argv.slice(2));
process.stdout.write(result.text);
process.exitCode = result.exitCode;
