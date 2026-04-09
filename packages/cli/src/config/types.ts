/**
 * CLI 扩展配置类型 — 支持 Agentic 和 CodingPlan 新增配置项
 */

import type { WorkMode } from "@sacode/core";

export interface AgenticConfig {
  agentMode: "auto" | "manual"; // 工具执行模式（auto=自动批准安全工具，manual=每次确认）
  maxAgentIterations: number; // Agentic Loop 最大迭代次数（默认 25）
  autoApproveTools: string[]; // 自动批准的工具列表（默认 ["file_read", "file_search", "code_search"]）
  workMode: WorkMode; // 工作模式（smart | yolo | plan）
}

export interface CodingPlanPreferences {
  codingplanDefaultAccount?: string; // 默认 CodingPlan 账户 ID
}

export interface UIConfig {
  uiStyle: "gemini" | "classic"; // UI 风格（默认 "gemini"）
}

export interface ExtendedCLIConfig extends AgenticConfig, CodingPlanPreferences, UIConfig {}

export const DEFAULT_EXTENDED_CONFIG: ExtendedCLIConfig = {
  agentMode: "auto",
  maxAgentIterations: 25,
  workMode: "smart",
  autoApproveTools: ["file_read", "file_search", "code_search"],
  uiStyle: "gemini",
};

// CLI key 到配置字段的映射
export const CONFIG_KEY_MAP: Record<string, keyof ExtendedCLIConfig> = {
  "agent-mode": "agentMode",
  "max-iterations": "maxAgentIterations",
  "auto-approve": "autoApproveTools",
  "codingplan-account": "codingplanDefaultAccount",
  "work-mode": "workMode",
  "ui-style": "uiStyle",
};
