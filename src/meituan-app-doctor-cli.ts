import { runMeituanDoctorCli } from "./meituan-app-doctor.js";

try {
  const result = await runMeituanDoctorCli(process.argv.slice(2));
  process.stdout.write(result.text);
  process.exitCode = result.exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
