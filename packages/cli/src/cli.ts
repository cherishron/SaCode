#!/usr/bin/env bun
import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { isBunAvailable, getInstallPrompt } from "./lib/runtime-detector.js";
import { isFirstRun, getOnboardingMessage, markInitialized } from "./lib/first-run.js";
import {
  registerChatCommand,
  registerConfigCommand,
  registerSessionCommand,
  registerModelCommand,
  registerWorkspaceCommand,
  registerAuthCommand,
  registerCodeCommand,
  registerMemoryCommand,
  registerCronCommand,
  registerPluginCommand,
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

// 加载 .env 文件
function loadEnv(): void {
  // 查找 .env 文件：当前目录或父目录
  const envPaths = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", ".env"),
    resolve(__dirname, "..", "..", "..", ".env"),
  ];

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      const lines = content.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        // 跳过注释和空行
        if (!trimmed || trimmed.startsWith("#")) continue;

        const equalIndex = trimmed.indexOf("=");
        if (equalIndex > 0) {
          const key = trimmed.slice(0, equalIndex).trim();
          let value = trimmed.slice(equalIndex + 1).trim();

          // 移除引号
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }

          // 设置环境变量（覆盖已存在的）
          process.env[key] = value;
        }
      }
      break;
    }
  }
}

// 在任何命令执行前加载环境变量
loadEnv();

// Bun 运行时检测
if (!isBunAvailable()) {
  console.error(getInstallPrompt());
  process.exit(1);
}

// 首次运行引导
if (isFirstRun()) {
  console.log(getOnboardingMessage());
  markInitialized();
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    console.log(""); // 空行分隔
  }
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
registerSessionCommand(ctx);
registerModelCommand(ctx);
registerWorkspaceCommand(ctx);

// 新命令
registerAuthCommand(ctx);
registerCodeCommand(ctx);
registerMemoryCommand(ctx);
registerCronCommand(ctx);
registerPluginCommand(ctx);

// 默认行为 - 直接进入交互式聊天
program.action(async (_options) => {
  const { startChat } = await import("./commands/chat.js");
  await startChat({});
});

program.parse();

export { program };