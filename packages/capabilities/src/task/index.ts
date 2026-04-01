/**
 * 任务管理工具模块
 *
 * 提供任务创建和更新的工具接口
 */

import type { ToolDefinition } from "../types";
import type { TaskCapabilityConfig } from "../types";
import { createTaskCreateTool, createTaskUpdateTool, createCronCreateTool } from "./adapter";

/**
 * 创建任务管理工具
 */
export function createTaskTools(config: TaskCapabilityConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  if (!config.enabled) {
    return tools;
  }

  // task_create_tool
  tools.push(createTaskCreateTool(config));

  // task_update_tool
  tools.push(createTaskUpdateTool(config));

  // cron_create_tool
  tools.push(createCronCreateTool(config));

  return tools;
}