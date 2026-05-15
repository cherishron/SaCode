#!/usr/bin/env bun
import { Command } from "commander";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { isBunAvailable, getInstallPrompt } from "./lib/runtime-detector.js";
import { isFirstRun, getOnboardingMessage, markInitialized } from "./lib/first-run.js";
import {
  registerChatCommand,
  registerConfigCommand,
  registerModelCommand,
  registerAuthCommand,
} from "./commands/index.js";

// ES 模块中的 __dirname 替代方案
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 从 package.json 读取版本号
function getPackageVersion(): string {
  try {
    const packageJsonPath = resolve(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Bun 运行时检测
if (!isBunAvailable()) {
  console.error(getInstallPrompt());
  process.exit(1);
}

// 首次运行引导
if (isFirstRun()) {
  console.log(getOnboardingMessage());
  markInitialized();
  console.log("");
}

const program = new Command();

program
  .name("sacode")
  .description("SaCode - 多端 AI 助手命令行工具")
  .version(getPackageVersion())
  .option("-d, --debug", "启用调试模式")
  .option("-c, --config <path>", "指定配置文件路径");

// 注册命令
const ctx = { program };
registerChatCommand(ctx);
registerConfigCommand(ctx);
registerModelCommand(ctx);
registerAuthCommand(ctx);

// 默认行为 - 直接进入交互式聊天
program.action(async (_options) => {
  const { startChat } = await import("./commands/chat.js");
  await startChat({});
});

program.parse();

export { program };
