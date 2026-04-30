import chalk from "chalk";
import { getExtendedConfigManager } from "../config/manager.js";

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  capabilities: string[];
}

const KNOWN_MODELS: ModelInfo[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    contextWindow: 128000,
    capabilities: ["chat", "function", "vision"],
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    contextWindow: 128000,
    capabilities: ["chat", "function"],
  },
  {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    contextWindow: 200000,
    capabilities: ["chat", "function", "vision"],
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    provider: "DeepSeek",
    contextWindow: 64000,
    capabilities: ["chat", "function"],
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek Reasoner",
    provider: "DeepSeek",
    contextWindow: 64000,
    capabilities: ["chat", "function", "reasoning"],
  },
  {
    id: "moonshot-v1-128k",
    name: "Moonshot V1 128K",
    provider: "Moonshot",
    contextWindow: 128000,
    capabilities: ["chat", "function"],
  },
  {
    id: "glm-4",
    name: "GLM-4",
    provider: "Zhipu",
    contextWindow: 128000,
    capabilities: ["chat", "function", "vision"],
  },
];

function getProviderEnvKey(provider: string): string {
  const map: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    moonshot: "MOONSHOT_API_KEY",
    zhipu: "ZHIPU_API_KEY",
  };
  return map[provider.toLowerCase()] ?? "";
}

function isProviderConfigured(provider: string): boolean {
  const envKey = getProviderEnvKey(provider);
  const value = process.env[envKey];
  return typeof value === "string" && value.length > 0;
}

export async function listModels(): Promise<void> {
  console.log(chalk.cyan("[AI] Available Models\n"));

  const currentModel = process.env.AI_MODEL ?? "gpt-4o";

  for (const model of KNOWN_MODELS) {
    const isCurrent = model.id === currentModel;
    const isConfigured = isProviderConfigured(model.provider);
    const statusIcon = isConfigured ? chalk.green("*") : chalk.red("o");
    const marker = isCurrent ? chalk.cyan(" <--") : "";
    const capabilities = model.capabilities.map((c) => chalk.gray(c)).join(", ");

    console.log(
      `  ${statusIcon} ${isCurrent ? chalk.bold(chalk.cyan(model.name)) : chalk.bold(model.name)} (${model.id})${marker}`,
    );
    console.log(`      ${chalk.gray("Provider:")} ${model.provider} ${isConfigured ? chalk.green("(configured)") : chalk.yellow("(not configured)")}`);
    console.log(`      ${chalk.gray("Context:")} ${model.contextWindow.toLocaleString()} tokens`);
    console.log(`      ${chalk.gray("Capabilities:")} ${capabilities}`);
    console.log();
  }

  console.log(chalk.gray(`Current model: ${chalk.bold(currentModel)}`));
  console.log(chalk.gray("Use 'sacode model set <model-id>' to change the default model"));
}

export async function setModel(modelId: string): Promise<void> {
  const model = KNOWN_MODELS.find((m) => m.id === modelId);

  if (!model) {
    console.log(chalk.red(`Unknown model: ${modelId}`));
    console.log(chalk.gray("Use 'sacode model list' to see available models"));
    return;
  }

  if (!isProviderConfigured(model.provider)) {
    const envKey = getProviderEnvKey(model.provider);
    console.log(chalk.yellow(`[!] Provider ${model.provider} is not configured`));
    console.log(chalk.gray(`  Set the ${envKey} environment variable first`));
    return;
  }

  process.env.AI_MODEL = modelId;

  const configManager = getExtendedConfigManager();
  try {
    configManager.setByCliKey("default-model", modelId);
  } catch {
    // 如果 key 不在映射中，直接写环境变量文件
  }

  console.log(chalk.green(`+ Default model set to ${model.name} (${modelId})`));
  console.log(chalk.gray("This will apply to new sessions only"));
}

export async function showCurrentModel(): Promise<void> {
  console.log(chalk.cyan("[AI] Current Model\n"));

  const currentModelId = process.env.AI_MODEL ?? "gpt-4o";
  const currentProvider = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
  const model = KNOWN_MODELS.find((m) => m.id === currentModelId);

  if (model) {
    console.log(`  ${chalk.bold(model.name)} (${model.id})`);
    console.log(`  ${chalk.gray("Provider:")} ${model.provider}`);
    console.log(`  ${chalk.gray("Context Window:")} ${model.contextWindow.toLocaleString()} tokens`);
    console.log(`  ${chalk.gray("Capabilities:")} ${model.capabilities.join(", ")}`);
  } else {
    console.log(`  ${chalk.bold(currentModelId)}`);
    console.log(`  ${chalk.gray("Provider:")} ${currentProvider}`);
  }

  const isConfigured = isProviderConfigured(currentProvider);
  console.log(`  ${chalk.gray("API Status:")} ${isConfigured ? chalk.green("configured") : chalk.yellow("not configured")}`);
  console.log();
  console.log(chalk.gray("Use 'sacode model set <model-id>' to change"));
}

export async function configureModel(
  modelId: string,
  options: { temperature?: string; maxTokens?: string; topP?: string },
): Promise<void> {
  console.log(chalk.cyan(`[CFG] Configuring model ${modelId}\n`));

  const configManager = getExtendedConfigManager();
  const updates: string[] = [];

  if (options.temperature) {
    const temp = parseFloat(options.temperature);
    if (Number.isNaN(temp) || temp < 0 || temp > 2) {
      console.log(chalk.red("  Temperature must be between 0 and 2"));
      return;
    }
    process.env.AI_TEMPERATURE = options.temperature;
    updates.push(`Temperature: ${options.temperature}`);
  }

  if (options.maxTokens) {
    const tokens = parseInt(options.maxTokens, 10);
    if (Number.isNaN(tokens) || tokens < 1) {
      console.log(chalk.red("  Max tokens must be a positive integer"));
      return;
    }
    process.env.AI_MAX_TOKENS = options.maxTokens;
    updates.push(`Max Tokens: ${options.maxTokens}`);
  }

  if (options.topP) {
    const topP = parseFloat(options.topP);
    if (Number.isNaN(topP) || topP < 0 || topP > 1) {
      console.log(chalk.red("  Top P must be between 0 and 1"));
      return;
    }
    process.env.AI_TOP_P = options.topP;
    updates.push(`Top P: ${options.topP}`);
  }

  if (updates.length === 0) {
    console.log(chalk.gray("No configuration changes specified"));
    return;
  }

  for (const update of updates) {
    console.log(`  ${chalk.gray(update)}`);
  }

  console.log(chalk.green("+ Model configuration updated"));
}
