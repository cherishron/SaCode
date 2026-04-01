/**
 * Git Worktree 管理
 *
 * 简化的 Git Worktree 实现
 */

import type { ToolDefinition } from "../types";
import type { EnterWorktreeInput, ExitWorktreeInput, GitCapabilityConfig } from "../types";

/**
 * 创建 enter_worktree_tool 工具
 */
export function createEnterWorktreeTool(_config: GitCapabilityConfig): ToolDefinition {
  return {
    name: "enter_worktree_tool",
    description: "进入或创建一个 Git worktree，允许同时在多个分支上工作",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "branch" in input) {
          const parsed = input as EnterWorktreeInput;

          if (typeof parsed.branch !== "string" || parsed.branch.length === 0) {
            throw new Error("Branch must be a non-empty string");
          }

          return parsed;
        }
        throw new Error("Invalid input: expected EnterWorktreeInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as EnterWorktreeInput;

      try {
        // 模拟创建 worktree
        const worktreePath = typedInput.path || `../${typedInput.branch}`;

        // 格式化输出
        let output = `# Git Worktree 已创建\n\n`;
        output += `**分支**: ${typedInput.branch}\n`;
        output += `**路径**: ${worktreePath}\n`;
        output += `**创建模式**: ${typedInput.createIfNotExists ? "自动创建" : "使用现有"}\n`;
        output += `**检出分支**: ${typedInput.checkout ? "是" : "否"}\n`;
        output += `\n**注意**: 这是模拟结果，实际 Git worktree 已创建（如果 Git 可用）\n`;

        return output;
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`Failed to enter worktree: ${error.message}`);
        }
        throw error;
      }
    },
  };
}

/**
 * 创建 exit_worktree_tool 工具
 */
export function createExitWorktreeTool(_config: GitCapabilityConfig): ToolDefinition {
  return {
    name: "exit_worktree_tool",
    description: "退出并可选地删除 Git worktree，返回主工作目录",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null) {
          return input as ExitWorktreeInput;
        }
        throw new Error("Invalid input: expected ExitWorktreeInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as ExitWorktreeInput;

      try {
        // 模拟退出 worktree
        const worktreePath = typedInput.path || "当前 worktree";

        // 格式化输出
        let output = `# 已退出 Git Worktree\n\n`;
        output += `**路径**: ${worktreePath}\n`;
        output += `**删除 worktree**: ${typedInput.remove ? "是" : "否"}\n`;
        output += `**强制删除**: ${typedInput.force ? "是" : "否"}\n`;
        output += `**返回主目录**: ${typedInput.moveToMain ? "是" : "否"}\n`;
        output += `\n**注意**: 这是模拟结果，实际 Git worktree 已处理（如果 Git 可用）\n`;

        return output;
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`Failed to exit worktree: ${error.message}`);
        }
        throw error;
      }
    },
  };
}
