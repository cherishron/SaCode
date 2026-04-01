import chalk from "chalk";

// 简单的内存配置存储
const config = new Map<string, string>([
  ["iflow.acpUrl", process.env.IFLOW_ACP_URL || "ws://localhost:8090/acp"],
  ["iflow.autoStart", process.env.IFLOW_AUTO_START || "true"],
  ["iflow.timeout", process.env.IFLOW_TIMEOUT || "60000"],
  ["server.port", process.env.PORT || "3000"],
  ["server.host", process.env.HOST || "localhost"],
]);

export async function listConfig(): Promise<void> {
  console.log(chalk.cyan("📋 Configuration\n"));

  for (const [key, value] of config) {
    console.log(`  ${chalk.green(key)}: ${chalk.gray(value)}`);
  }
}

export async function setConfig(key: string, value: string): Promise<void> {
  config.set(key, value);
  console.log(chalk.green(`✓ Set ${key} = ${value}`));
}

export async function getConfig(key: string): Promise<void> {
  const value = config.get(key);
  if (value !== undefined) {
    console.log(`${chalk.green(key)}: ${chalk.gray(value)}`);
  } else {
    console.log(chalk.yellow(`Configuration key '${key}' not found`));
  }
}

export function getConfigValue(key: string): string | undefined {
  return config.get(key);
}
