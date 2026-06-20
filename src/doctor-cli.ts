import { formatDoctorReport, runDoctor } from "./doctor.js";

try {
  const report = await runDoctor();
  console.log(formatDoctorReport(report));
  process.exitCode = report.status === "fail" ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
