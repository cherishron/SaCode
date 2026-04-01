/**
 * Git Worktree 模块
 *
 * 提供 Git Worktree 管理能力
 */

import type { ToolDefinition } from "../types";
import type { GitCapabilityConfig } from "../types";
import { createEnterWorktreeTool, createExitWorktreeTool } from "./worktree";

/**
 * 创建 Git 工具
 */
export function createGitTools(config: GitCapabilityConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  if (!config.enabled) {
    return tools;
  }

  // enter_worktree_tool
  tools.push(createEnterWorktreeTool(config));

  // exit_worktree_tool
  tools.push(createExitWorktreeTool(config));

  return tools;
}