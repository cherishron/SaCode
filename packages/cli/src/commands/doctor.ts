import chalk from "chalk";
import { formatDoctorReport, runDoctor, type DoctorReport } from "../lib/doctor.js";

export async function showDoctor(options: { json?: boolean } = {}): Promise<void> {
  const report = await runDoctor();

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printDoctorReport(report);
}

function printDoctorReport(report: DoctorReport): void {
  const [title, , providerTitle, ...rest] = formatDoctorReport(report).split("\n");
  console.log(chalk.cyan(`${title}\n`));
  console.log(chalk.bold(providerTitle));

  for (const line of rest) {
    if (line === "Workspace" || line === "Checks") {
      console.log();
      console.log(chalk.bold(line));
    } else if (line === "Doctor passed") {
      console.log();
      console.log(chalk.green(line));
    } else if (line === "Doctor found blocking issues") {
      console.log();
      console.log(chalk.red(line));
    } else if (line) {
      console.log(`  ${line}`);
    }
  }
}
