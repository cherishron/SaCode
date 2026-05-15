import chalk from "chalk";
import { getPreferenceManager, type UserPreferences } from "@sacode/core";
import { getExtendedConfigManager, ExtendedConfigManager } from "../config/index.js";

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

function parsePreferenceValue<K extends keyof UserPreferences>(
  key: K,
  value: string,
): UserPreferences[K] {
  if (key === "showToolDetails" || key === "showThinking") {
    return (value === "true" || value === "1" || value === "yes") as UserPreferences[K];
  }

  return value as UserPreferences[K];
}

export async function listConfig(): Promise<void> {
  console.log(chalk.cyan("\n[PL] 配置\n"));

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

  // 扩展配置
  console.log(chalk.bold("\n扩展配置 (~/.sacode/cli-config.json):"));
  const extManager = getExtendedConfigManager();
  const extEntries = extManager.listAll();
  for (const [key, value] of Object.entries(extEntries)) {
    console.log(`  ${chalk.green(key)}: ${chalk.gray(String(value ?? "(未设置)"))}`);
  }
  console.log(chalk.gray(`配置文件位置: ${extManager.getConfigPath()}`));
  console.log(chalk.gray(`可用的扩展配置项: ${ExtendedConfigManager.getAvailableKeys().join(", ")}`));
}

export async function setConfig(key: string, value: string): Promise<void> {
  // 检查是否是偏好设置
  const prefKey = preferenceKeyMap[key];
  
  if (prefKey) {
    const prefManager = getPreferenceManager();

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

    const typedValue = parsePreferenceValue(prefKey, value);
    prefManager.set(prefKey, typedValue);
    console.log(chalk.green(`+ 已设置 ${key} = ${String(typedValue)}`));
    console.log(chalk.gray(`配置已保存到: ${prefManager.getConfigPath()}`));
    return;
  }

  // 检查是否是扩展配置
  const extKey = ExtendedConfigManager.resolveCliKey(key);
  if (extKey) {
    const extManager = getExtendedConfigManager();
    try {
      extManager.setByCliKey(key, value);
      const displayValue = extManager.getByCliKey(key);
      console.log(chalk.green(`+ 已设置 ${key} = ${Array.isArray(displayValue) ? (displayValue as string[]).join(", ") : displayValue}`));
      console.log(chalk.gray(`配置已保存到: ${extManager.getConfigPath()}`));
    } catch (err) {
      console.log(chalk.red(`设置失败: ${(err as Error).message}`));
    }
    return;
  }

  // 环境变量配置（仅内存）
  envConfig.set(key, value);
  console.log(chalk.green(`+ 已设置 ${key} = ${value}`));
  console.log(chalk.yellow("[!] 此配置仅在当前会话有效，永久设置请写入 ~/.sacode 配置或系统环境变量"));
}

export async function getConfig(key: string): Promise<void> {
  // 检查偏好设置
  const prefKey = preferenceKeyMap[key];
  
  if (prefKey) {
    const prefManager = getPreferenceManager();
    const value = prefManager.get(prefKey);
    console.log(`${chalk.green(key)}: ${chalk.gray(String(value))}`);
    return;
  }

  // 检查扩展配置
  const extKey = ExtendedConfigManager.resolveCliKey(key);
  if (extKey) {
    const extManager = getExtendedConfigManager();
    const value = extManager.getByCliKey(key);
    const display = Array.isArray(value) ? (value as string[]).join(", ") : String(value ?? "(未设置)");
    console.log(`${chalk.green(key)}: ${chalk.gray(display)}`);
    return;
  }

  // 环境变量配置
  const value = envConfig.get(key);
  if (value !== undefined) {
    console.log(`${chalk.green(key)}: ${chalk.gray(value)}`);
  } else {
    console.log(chalk.yellow(`配置项 '${key}' 未找到`));
    console.log(chalk.gray(`可用的扩展配置项: ${ExtendedConfigManager.getAvailableKeys().join(", ")}`));
  }
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
  console.log(chalk.green("+ 偏好设置已重置为默认值"));
}

/**
 * 重置扩展配置
 */
export async function resetExtendedConfig(): Promise<void> {
  const extManager = getExtendedConfigManager();
  extManager.reset();
  console.log(chalk.green("+ 扩展配置已重置为默认值"));
}

/**
 * 重置所有配置（偏好 + 扩展）
 */
export async function resetAllConfig(): Promise<void> {
  await resetPreferences();
  await resetExtendedConfig();
}

/**
 * 设置自定义指令
 */
export async function setCustomInstructions(instructions: string): Promise<void> {
  const prefManager = getPreferenceManager();
  prefManager.set("customInstructions", instructions);
  console.log(chalk.green("+ 自定义指令已设置"));
  console.log(chalk.gray("这将在每次对话中自动注入到系统提示词中"));
}
