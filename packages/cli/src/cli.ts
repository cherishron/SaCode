#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import {
  registerChatCommand,
  registerDoctorCommand,
  registerConfigCommand,
  registerToolCommand,
  registerModelCommand,
} from "./commands/index.js";
import { normalizeRootPrompt } from "./lib/cli-options.js";

const program = new Command();

program
  .name("sacode")
  .description("SaCode - 基于 iFlow SDK 的多端 AI 助手")
  .version("0.1.0")
  .argument("[prompt...]", "单次提示，等同于 chat --print --message")
  .option("-p, --print", "单次输出模式，执行后退出")
  .option("--json", "以 JSON 输出单次结果")
  .option("--stream-json", "以 NDJSON 事件流输出单次结果")
  .option("-d, --debug", "启用调试模式")
  .option("-c, --config <path>", "指定配置文件路径");

// 注册命令
const ctx = { program };
registerChatCommand(ctx);
registerDoctorCommand(ctx);
registerConfigCommand(ctx);
registerToolCommand(ctx);
registerModelCommand(ctx);

// 默认行为 - 进入 Agent CLI Shell；传入 prompt 时执行单次任务
program.action(async (promptParts: string[], options: { print?: boolean; json?: boolean; streamJson?: boolean }) => {
  const chatOptions = normalizeRootPrompt(promptParts, options);
  if (chatOptions) {
    const { startChat } = await import("./commands/chat.js");
    await startChat(chatOptions);
    return;
  }

  const { startChat } = await import("./commands/chat.js");
  await startChat({});
});

program.parse();

export { program };
