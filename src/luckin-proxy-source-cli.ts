import { runLuckinProxySourceCli } from "./luckin-proxy-source.js";

const result = await runLuckinProxySourceCli(process.argv.slice(2));
process.stdout.write(result.text);
process.exitCode = result.exitCode;
