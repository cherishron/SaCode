import chalk from "chalk";

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  capabilities: string[];
  status: "available" | "unavailable";
}

/**
 * 列出所有可用模型
 */
export async function listModels(): Promise<void> {
  console.log(chalk.cyan("🤖 Available Models\n"));

  // 模拟数据 - 实际应从iFlow SDK获取
  const models: ModelInfo[] = [
    {
      id: "minimax-m2.5",
      name: "MiniMax M2.5",
      provider: "MiniMax",
      contextWindow: 128000,
      capabilities: ["chat", "function", "vision"],
      status: "available",
    },
    {
      id: "glm-5",
      name: "GLM-5",
      provider: "Zhipu",
      contextWindow: 128000,
      capabilities: ["chat", "function", "vision"],
      status: "available",
    },
    {
      id: "kimi-k2.5",
      name: "Kimi K2.5",
      provider: "Moonshot",
      contextWindow: 128000,
      capabilities: ["chat", "function", "vision"],
      status: "available",
    },
    {
      id: "qwen3",
      name: "Qwen3",
      provider: "Ollama (Local)",
      contextWindow: 32000,
      capabilities: ["chat", "function"],
      status: "available",
    },
    {
      id: "claude-3-5-sonnet",
      name: "Claude 3.5 Sonnet",
      provider: "Anthropic",
      contextWindow: 200000,
      capabilities: ["chat", "function", "vision"],
      status: "unavailable",
    },
  ];

  for (const model of models) {
    const statusIcon = model.status === "available" ? chalk.green("●") : chalk.red("○");
    const capabilities = model.capabilities.map((c) => chalk.gray(c)).join(", ");

    console.log(`  ${statusIcon} ${chalk.bold(model.name)} (${model.id})`);
    console.log(`      ${chalk.gray("Provider:")} ${model.provider}`);
    console.log(`      ${chalk.gray("Context:")} ${model.contextWindow.toLocaleString()} tokens`);
    console.log(`      ${chalk.gray("Capabilities:")} ${capabilities}`);
    console.log();
  }

  console.log(chalk.gray("Use 'saclaw model set <model-id>' to change the default model"));
}

/**
 * 设置默认模型
 */
export async function setModel(modelId: string): Promise<void> {
  console.log(chalk.cyan(`🔄 Setting default model to ${modelId}...`));

  // TODO: 验证模型可用性并设置
  console.log(chalk.green(`✓ Default model set to ${modelId}`));
  console.log(chalk.gray("This will apply to new sessions only"));
}

/**
 * 显示当前模型
 */
export async function showCurrentModel(): Promise<void> {
  console.log(chalk.cyan("🤖 Current Model\n"));

  // 模拟当前配置
  const currentModel = {
    id: "minimax-m2.5",
    name: "MiniMax M2.5",
    provider: "MiniMax",
    contextWindow: 128000,
  };

  console.log(`  ${chalk.bold(currentModel.name)} (${currentModel.id})`);
  console.log(`  ${chalk.gray("Provider:")} ${currentModel.provider}`);
  console.log(`  ${chalk.gray("Context Window:")} ${currentModel.contextWindow.toLocaleString()} tokens`);
  console.log();
  console.log(chalk.gray("Use 'saclaw model set <model-id>' to change"));
}

/**
 * 配置模型参数
 */
export async function configureModel(
  modelId: string,
  options: { temperature?: string; maxTokens?: string; topP?: string }
): Promise<void> {
  console.log(chalk.cyan(`⚙️ Configuring model ${modelId}\n`));

  if (options.temperature) {
    console.log(`  ${chalk.gray("Temperature:")} ${options.temperature}`);
  }
  if (options.maxTokens) {
    console.log(`  ${chalk.gray("Max Tokens:")} ${options.maxTokens}`);
  }
  if (options.topP) {
    console.log(`  ${chalk.gray("Top P:")} ${options.topP}`);
  }

  // TODO: 实际保存配置
  console.log(chalk.green("✓ Model configuration updated"));
}
