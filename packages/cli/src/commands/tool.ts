import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ConfirmationRequest } from "@sacode/core";
import { createCliCapabilities, createCliToolRegistryAdapter } from "../lib/capabilities.js";
import { parseToolParams } from "../lib/cli-options.js";

export async function listTools(): Promise<void> {
  const capabilities = createCliCapabilities();
  const tools = capabilities.getRegistry().list();

  console.log(chalk.cyan("🔧 Tools\n"));

  for (const tool of tools) {
    console.log(`  ${chalk.green(tool.name)}`);
    console.log(`    ${chalk.gray(tool.description)}`);
  }

  console.log();
  console.log(chalk.gray("Use 'sacode tool run <name> --param key=value' to run a tool"));

  await capabilities.shutdown();
}

export async function runTool(
  name: string,
  options: { param?: string[] }
): Promise<void> {
  const cwd = process.cwd();
  const { capabilities, registry } = createCliToolRegistryAdapter(cwd, {
    confirm: confirmToolExecution,
  });
  const tool = registry.list().find((item) => item.name === name);

  if (!tool) {
    console.log(chalk.red(`Tool not found: ${name}`));
    await capabilities.shutdown();
    return;
  }

  console.log(chalk.cyan(`🔧 Running tool: ${name}\n`));

  const params = parseToolParams(options.param, cwd);

  console.log(chalk.gray("Parameters:"));
  for (const [key, value] of Object.entries(params)) {
    console.log(`  ${key}: ${value}`);
  }

  console.log();
  try {
    const result = await registry.execute(name, params);
    console.log(chalk.green("✓ Tool executed"));
    console.log(formatResult(result));
  } catch (error) {
    console.log(chalk.red("✗ Tool failed"));
    console.log(chalk.red(error instanceof Error ? error.message : String(error)));
  } finally {
    await capabilities.shutdown();
  }
}

async function confirmToolExecution(request: ConfirmationRequest): Promise<boolean> {
  console.log(chalk.yellow("Tool confirmation required"));
  console.log(`  Tool: ${request.toolName}`);
  console.log(`  Risk: ${request.riskLevel}`);
  console.log(`  Reason: ${request.reason}`);
  console.log(chalk.gray(`  Args: ${JSON.stringify(request.args, null, 2)}`));

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Allow this tool execution? [y/N] ");
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

function formatResult(result: unknown): string {
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}
