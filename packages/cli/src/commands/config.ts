import chalk from "chalk";
import { getPreferenceManager, type UserPreferences } from "@sacode/core";
import { initUserConfig, isSupportedProvider, type SupportedProvider } from "../lib/config-init.js";

// 简单的内存配置存储（环境变量）
const envConfig = new Map<string, string>([
  ["iflow.acpUrl", process.env.IFLOW_ACP_URL || "ws://localhost:8090/acp"],
  ["iflow.autoStart", process.env.IFLOW_AUTO_START || "true"],
  ["iflow.timeout", process.env.IFLOW_TIMEOUT || "60000"],
  ["server.port", process.env.PORT || "3000"],
  ["server.host", process.env.HOST || "localhost"],
]);

// 偏好设置的键名映射
const preferenceKeyMap: Record<string, keyof UserPreferences> = {
  language: "language",
  lang: "language",
  model: "defaultModel",
  provider: "defaultProvider",
  instructions: "customInstructions",
  style: "outputStyle",
  "tool-details": "showToolDetails",
  thinking: "showThinking",
  theme: "theme",
  timezone: "timezone",
};

export async function listConfig(): Promise<void> {
  console.log(chalk.cyan("\n📋 配置\n"));

  // 环境变量配置
  console.log(chalk.bold("环境变量:"));
  for (const [key, value] of envConfig) {
    console.log(`  ${chalk.green(key)}: ${chalk.gray(value)}`);
  }

  // 用户偏好
  console.log(chalk.bold("\n用户偏好 (~/.sacode/preferences.json):"));
  const prefManager = getPreferenceManager();
  const prefs = prefManager.getAll();
  
  const prefEntries: [string, string][] = [
    ["language", prefs.language],
    ["defaultModel", prefs.defaultModel ?? "(未设置)"],
    ["defaultProvider", prefs.defaultProvider ?? "(未设置)"],
    ["outputStyle", prefs.outputStyle],
    ["showToolDetails", String(prefs.showToolDetails)],
    ["showThinking", String(prefs.showThinking)],
    ["theme", prefs.theme],
    ["customInstructions", prefs.customInstructions ? prefs.customInstructions.slice(0, 50) + "..." : "(未设置)"],
  ];
  
  for (const [key, value] of prefEntries) {
    console.log(`  ${chalk.green(key)}: ${chalk.gray(value)}`);
  }
  
  console.log(chalk.gray(`\n配置文件位置: ${prefManager.getConfigPath()}`));
}

export async function initConfig(options: {
  provider?: string;
  model?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
} = {}): Promise<void> {
  const provider = options.provider ?? "openai";
  if (!isSupportedProvider(provider)) {
    console.log(chalk.red(`不支持的 provider: ${provider}`));
    console.log(chalk.gray("支持: openai, anthropic, deepseek, moonshot, zhipu"));
    return;
  }

  const result = await initUserConfig({
    provider: provider as SupportedProvider,
    model: options.model,
    baseUrl: options.baseUrl,
    apiKeyEnv: options.apiKeyEnv,
  });

  console.log(chalk.green(`已更新用户级 Provider 配置: ${result.path}`));
  console.log(chalk.gray(`请在 shell 环境中设置 ${result.apiKeyEnv} 后运行: sacode doctor`));
}

export async function setConfig(key: string, value: string): Promise<void> {
  // 检查是否是偏好设置
  const prefKey = preferenceKeyMap[key];
  
  if (prefKey) {
    const prefManager = getPreferenceManager();
    
    // 类型转换
    let typedValue: string | boolean = value;
    if (["showToolDetails", "showThinking"].includes(prefKey)) {
      typedValue = value === "true" || value === "1" || value === "yes";
    }
    
    // 验证语言值
    if (prefKey === "language") {
      const validLangs = ["zh-CN", "en-US", "ja-JP", "ko-KR", "auto"];
      if (!validLangs.includes(value)) {
        console.log(chalk.red(`无效的语言: ${value}`));
        console.log(chalk.gray(`支持的语言: ${validLangs.join(", ")}`));
        return;
      }
    }
    
    // 验证输出风格
    if (prefKey === "outputStyle") {
      const validStyles = ["concise", "detailed", "verbose"];
      if (!validStyles.includes(value)) {
        console.log(chalk.red(`无效的输出风格: ${value}`));
        console.log(chalk.gray(`支持的风格: ${validStyles.join(", ")}`));
        return;
      }
    }
    
    prefManager.set(prefKey, typedValue as never);
    console.log(chalk.green(`✓ 已设置 ${key} = ${typedValue}`));
    console.log(chalk.gray(`配置已保存到: ${prefManager.getConfigPath()}`));
  } else {
    // 环境变量配置（仅内存）
    envConfig.set(key, value);
    console.log(chalk.green(`✓ 已设置 ${key} = ${value}`));
    console.log(chalk.yellow("此配置仅在当前进程有效；模型和语言等持久配置请使用用户级配置命令。"));
  }
}

export async function getConfig(key: string): Promise<void> {
  // 检查偏好设置
  const prefKey = preferenceKeyMap[key];
  
  if (prefKey) {
    const prefManager = getPreferenceManager();
    const value = prefManager.get(prefKey);
    console.log(`${chalk.green(key)}: ${chalk.gray(String(value))}`);
  } else {
    // 环境变量配置
    const value = envConfig.get(key);
    if (value !== undefined) {
      console.log(`${chalk.green(key)}: ${chalk.gray(value)}`);
    } else {
      console.log(chalk.yellow(`配置项 '${key}' 未找到`));
    }
  }
}

export async function configureLanguage(language?: string): Promise<void> {
  const prefManager = getPreferenceManager();
  prefManager.load();
  if (!language) {
    console.log(`language: ${chalk.gray(prefManager.get("language"))}`);
    console.log(`resolved: ${chalk.gray(prefManager.getResolvedLanguage())}`);
    console.log(chalk.gray(`配置文件位置: ${prefManager.getConfigPath()}`));
    return;
  }

  const validLangs = ["zh-CN", "en-US", "ja-JP", "ko-KR", "auto"];
  if (!validLangs.includes(language)) {
    console.log(chalk.red(`无效的语言: ${language}`));
    console.log(chalk.gray(`支持的语言: ${validLangs.join(", ")}`));
    return;
  }

  prefManager.set("language", language as UserPreferences["language"]);
  console.log(chalk.green(`language 已设置为 ${language}`));
  console.log(chalk.gray(`配置已保存到: ${prefManager.getConfigPath()}`));
}

export function getConfigValue(key: string): string | undefined {
  return envConfig.get(key);
}

/**
 * 重置偏好设置
 */
export async function resetPreferences(): Promise<void> {
  const prefManager = getPreferenceManager();
  prefManager.reset();
  console.log(chalk.green("✓ 偏好设置已重置为默认值"));
}

/**
 * 设置自定义指令
 */
export async function setCustomInstructions(instructions: string): Promise<void> {
  const prefManager = getPreferenceManager();
  prefManager.set("customInstructions", instructions);
  console.log(chalk.green("✓ 自定义指令已设置"));
  console.log(chalk.gray("这将在每次对话中自动注入到系统提示词中"));
}
