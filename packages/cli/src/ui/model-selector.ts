/**
 * 模型选择器 UI 组件
 * 
 * 提供交互式的厂商选择和模型选择界面
 */

import chalk from "chalk";
import { createInterface } from "readline";
import type { ProviderInfo } from "../lib/api-key-manager.js";
import type { ModelInfo } from "../lib/model-manager.js";

/**
 * 渲染厂商列表
 */
export function renderProviderList(
  providers: ProviderInfo[],
  configuredProviders: Set<string>
): string {
  let output = "\n";
  output += chalk.cyan("═".repeat(50)) + "\n";
  output += chalk.cyan("  选择模型厂商") + "\n";
  output += chalk.cyan("═".repeat(50)) + "\n\n";

  providers.forEach((provider, index) => {
    const isConfigured = configuredProviders.has(provider.id);
    const status = isConfigured ? chalk.green("✓") : chalk.gray("○");
    const name = chalk.white(provider.name);
    const id = chalk.gray(`(${provider.id})`);
    
    output += `  ${chalk.yellow(index + 1)}. ${status} ${name} ${id}\n`;
  });

  output += "\n";
  output += chalk.gray("  输入编号或厂商 ID 选择，输入 'q' 返回\n");
  output += chalk.cyan("─".repeat(50)) + "\n";

  return output;
}

/**
 * 渲染模型列表
 */
export function renderModelList(models: ModelInfo[], providerFilter?: string): string {
  let output = "\n";
  output += chalk.cyan("═".repeat(60)) + "\n";
  output += chalk.cyan(providerFilter ? `  ${providerFilter} 可用模型` : "  所有可用模型") + "\n";
  output += chalk.cyan("═".repeat(60)) + "\n\n";

  // 按厂商分组
  const grouped = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const existing = grouped.get(model.provider) || [];
    existing.push(model);
    grouped.set(model.provider, existing);
  }

  let index = 1;
  for (const [provider, providerModels] of grouped) {
    output += chalk.yellow(`${provider.toUpperCase()}\n`);
    
    for (const model of providerModels) {
      const id = chalk.white(model.id);
      const name = model.name !== model.id ? chalk.gray(` - ${model.name}`) : "";
      const desc = model.description ? chalk.gray(` (${model.description})`) : "";
      
      output += `  ${chalk.yellow(index++)}. ${id}${name}${desc}\n`;
    }
    
    output += "\n";
  }

  output += chalk.gray("  输入编号或模型 ID 选择，输入 'q' 返回\n");
  output += chalk.cyan("─".repeat(60)) + "\n";

  return output;
}

/**
 * 渲染 API Key 输入提示
 */
export function renderApiKeyInput(providerName: string): string {
  return `\n${chalk.cyan("═".repeat(50))}\n` +
    `  ${chalk.white(`请输入 ${providerName} API Key`)}\n\n` +
    chalk.gray("  Key 将以加密形式存储，不会显示在屏幕上\n") +
    chalk.gray("  输入后按 Enter 确认\n") +
    chalk.cyan("─".repeat(50)) + "\n\n" +
    chalk.yellow("  API Key: ");
}

/**
 * 渲染配置成功消息
 */
export function renderConfigSuccess(providerName: string, modelName?: string): string {
  let output = `\n${chalk.green("✓")} ${chalk.green.bold("配置成功")}\n\n`;
  output += `  厂商：${chalk.white(providerName)}\n`;
  if (modelName) {
    output += `  模型：${chalk.white(modelName)}\n`;
  }
  output += `\n${chalk.gray("现在可以开始使用了！")}\n`;
  return output;
}

/**
 * 渲染配置失败消息
 */
export function renderConfigError(message: string): string {
  return `\n${chalk.red("✗")} ${chalk.red.bold("配置失败")}\n\n` +
    `  ${chalk.red(message)}\n\n` +
    chalk.gray("请检查 API Key 是否正确，或网络连接是否正常\n");
}

/**
 * 交互式选择厂商
 */
export async function selectProvider(
  providers: ProviderInfo[],
  configuredProviders: Set<string>
): Promise<ProviderInfo | null> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(renderProviderList(providers, configuredProviders));

  return new Promise((resolve) => {
    rl.question(chalk.yellow("  > "), async (input) => {
      rl.close();
      
      const trimmed = input.trim().toLowerCase();
      
      if (trimmed === "q" || trimmed === "quit" || trimmed === "exit") {
        resolve(null);
        return;
      }

      // 尝试解析为编号
      const index = parseInt(trimmed, 10);
      if (!isNaN(index) && index >= 1 && index <= providers.length) {
        resolve(providers[index - 1] ?? null);
        return;
      }

      // 尝试解析为厂商 ID
      const provider = providers.find(p => p.id === trimmed);
      if (provider) {
        resolve(provider);
        return;
      }

      console.log(chalk.red("无效的选择，请重试"));
      resolve(null);
    });
  });
}

/**
 * 交互式选择模型
 */
export async function selectModel(
  models: ModelInfo[],
  providerFilter?: string
): Promise<ModelInfo | null> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(renderModelList(models, providerFilter));

  return new Promise((resolve) => {
    rl.question(chalk.yellow("  > "), async (input) => {
      rl.close();
      
      const trimmed = input.trim().toLowerCase();
      
      if (trimmed === "q" || trimmed === "quit" || trimmed === "exit") {
        resolve(null);
        return;
      }

      // 尝试解析为编号
      const index = parseInt(trimmed, 10);
      if (!isNaN(index) && index >= 1 && index <= models.length) {
        resolve(models[index - 1] ?? null);
        return;
      }

      // 尝试解析为模型 ID
      const model = models.find(m => m.id === trimmed);
      if (model) {
        resolve(model);
        return;
      }

      console.log(chalk.red("无效的选择，请重试"));
      resolve(null);
    });
  });
}

/**
 * 隐蔽输入（用于 API Key 输入）
 */
export async function readHiddenInput(prompt: string): Promise<string> {
  createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // 注意：Node.js 的 readline 不支持真正的隐藏输入
  // 这里我们使用一个简单的替代方案
  console.log(prompt);
  
  return new Promise((resolve) => {
    let input = "";
    
    const stdin = process.stdin as any;
    const oldMode = stdin.isRaw;
    
    if (oldMode) stdin.setRawMode(true);
    
    stdin.on("data", (key: Buffer) => {
      const char = key.toString();
      
      if (char === "\r" || char === "\n") {
        if (oldMode) stdin.setRawMode(false);
        stdin.removeAllListeners("data");
        console.log();
        resolve(input);
        return;
      }
      
      if (char === "\x03") { // Ctrl+C
        if (oldMode) stdin.setRawMode(false);
        stdin.removeAllListeners("data");
        console.log();
        resolve("");
        return;
      }
      
      if (char === "\x7f" || char === "\b") { // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        input += char;
        process.stdout.write("*");
      }
    });
  });
}

/**
 * 渲染当前配置状态
 */
export function renderCurrentConfig(
  currentProvider?: string,
  currentModel?: string,
  configuredCount?: number
): string {
  let output = `\n${chalk.cyan("当前配置")}\n`;
  output += chalk.gray("─".repeat(30)) + "\n";
  
  if (currentProvider) {
    output += `  厂商：${chalk.green(currentProvider)}\n`;
  } else {
    output += `  厂商：${chalk.yellow("未设置")}\n`;
  }
  
  if (currentModel) {
    output += `  模型：${chalk.green(currentModel)}\n`;
  } else {
    output += `  模型：${chalk.yellow("未设置")}\n`;
  }
  
  if (configuredCount !== undefined) {
    output += `  已配置厂商：${chalk.green(configuredCount.toString())}\n`;
  }
  
  output += chalk.gray("─".repeat(30)) + "\n";
  
  return output;
}
