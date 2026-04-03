#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  registerChatCommand,
  registerConfigCommand,
  registerIMCommand,
  registerStartCommand,
  registerPluginCommand,
  registerToolCommand,
  registerSkillCommand,
  registerSessionCommand,
  registerCronCommand,
  registerModelCommand,
  registerStatusCommand,
  registerWorkspaceCommand,
} from "./commands/index.js";

// ES 模块中的 __dirname 替代方案
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

const program = new Command();

program
  .name("SACODE")
  .description("SACODE - 基于 iFlow SDK 的多端 AI 助手")
  .version("0.1.0")
  .option("-d, --debug", "启用调试模式")
  .option("-c, --config <path>", "指定配置文件路径");

// 注册命令
const ctx = { program };
registerChatCommand(ctx);
registerConfigCommand(ctx);
registerIMCommand(ctx);
registerStartCommand(ctx);
registerPluginCommand(ctx);
registerToolCommand(ctx);
registerSkillCommand(ctx);
registerSessionCommand(ctx);
registerCronCommand(ctx);
registerModelCommand(ctx);
registerStatusCommand(ctx);
registerWorkspaceCommand(ctx);

// 默认行为 - 显示帮助
program.action(() => {
  console.log(chalk.cyan("\n🦞 SACODE - 多端 AI 助手框架\n"));
  console.log(chalk.gray("常用命令:"));
  console.log("  SACODE chat              启动交互式聊天");
  console.log("  SACODE start             启动服务");
  console.log("  SACODE status show       查看系统状态");
  console.log("  SACODE session list      列出所有会话");
  console.log("  SACODE cron list         列出定时任务");
  console.log("  SACODE model list        列出可用模型");
  console.log("  SACODE im list           列出 IM 连接");
  console.log("  SACODE workspace init    初始化工作空间");
  console.log("  SACODE skills search     搜索技能");
  console.log("  SACODE config list       查看配置");
  console.log();
  console.log(chalk.gray("使用 --help 查看更多命令"));
});

program.parse();

export { program };