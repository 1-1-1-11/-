import { runLuckinSetupCli } from "./luckin-setup.js";

const result = await runLuckinSetupCli(process.argv.slice(2));
process.stdout.write(result.text);
process.exitCode = result.exitCode;
