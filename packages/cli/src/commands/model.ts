import chalk from "chalk";
import { ensureProviderStore, formatModels, setDefaultModel, testModelConfiguration } from "../lib/provider-store.js";

/**
 * 列出所有可用模型
 */
export async function listModels(): Promise<void> {
  console.log(formatModels(await ensureProviderStore()));
  console.log(chalk.gray("Use 'sacode model set <provider>/<model>' to change the default model"));
}

/**
 * 设置默认模型
 */
export async function setModel(modelId: string): Promise<void> {
  const updated = await setDefaultModel(modelId);
  console.log(chalk.green(`Default model set to ${updated.defaultModel}`));
  console.log(chalk.gray("This will apply to new sessions only"));
}

/**
 * 显示当前模型
 */
export async function showCurrentModel(): Promise<void> {
  const store = await ensureProviderStore();
  console.log(chalk.cyan("Current Model\n"));
  console.log(`  ${chalk.bold(store.defaultModel ?? "not configured")}`);
  if (store.defaultModel) {
    console.log(chalk.gray(testModelConfiguration(store, store.defaultModel).message));
  }
  console.log(chalk.gray("Use 'sacode model set <provider>/<model>' to change"));
}

/**
 * 配置模型参数
 */
export async function configureModel(
  modelId: string,
  options: { temperature?: string; maxTokens?: string; topP?: string }
): Promise<void> {
  console.log(chalk.cyan(`Configuring model ${modelId}\n`));

  if (options.temperature) {
    console.log(`  ${chalk.gray("Temperature:")} ${options.temperature}`);
  }
  if (options.maxTokens) {
    console.log(`  ${chalk.gray("Max Tokens:")} ${options.maxTokens}`);
  }
  if (options.topP) {
    console.log(`  ${chalk.gray("Top P:")} ${options.topP}`);
  }

  await setDefaultModel(modelId);
  console.log(chalk.green("Model configuration updated"));
}
