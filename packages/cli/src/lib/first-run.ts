/**
 * 首次运行检测
 */

import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SACODE_DIR = join(homedir(), ".sacode");
const FIRST_RUN_MARKER = join(SACODE_DIR, ".initialized");

export function isFirstRun(): boolean {
  return !existsSync(FIRST_RUN_MARKER);
}

export function hasConfiguredProvider(): boolean {
  const envKeys = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "MOONSHOT_API_KEY",
    "ZHIPU_API_KEY",
  ];
  return envKeys.some((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.length > 0;
  });
}

export function getOnboardingMessage(): string {
  const lines: string[] = [];

  if (!hasConfiguredProvider()) {
    lines.push(
      "欢迎使用 SaCode CLI!",
      "",
      "尚未配置 AI Provider API Key。请选择一个 Provider 进行配置:",
      "",
      "  OpenAI:     export OPENAI_API_KEY=sk-...",
      "  Anthropic:  export ANTHROPIC_API_KEY=sk-ant-...",
      "  DeepSeek:   export DEEPSEEK_API_KEY=sk-...",
      "  Moonshot:   export MOONSHOT_API_KEY=sk-...",
      "  智谱:       export ZHIPU_API_KEY=...",
      "",
      "配置完成后，运行 'sacode chat' 开始对话。",
      "也可以使用 'sacode config set' 命令进行更多配置。"
    );
  } else {
    lines.push(
      "欢迎使用 SaCode CLI!",
      "",
      "已检测到 AI Provider 配置。运行 'sacode chat' 开始对话。"
    );
  }

  return lines.join("\n");
}

export function markInitialized(): void {
  const { mkdirSync, writeFileSync } = require("fs") as typeof import("fs");
  if (!existsSync(SACODE_DIR)) {
    mkdirSync(SACODE_DIR, { recursive: true });
  }
  writeFileSync(FIRST_RUN_MARKER, new Date().toISOString());
}
