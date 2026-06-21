import { runMcdOfficialSourceCli } from "./mcd-official-source.js";

const result = await runMcdOfficialSourceCli(process.argv.slice(2));
process.stdout.write(result.text);
process.exitCode = result.exitCode;
