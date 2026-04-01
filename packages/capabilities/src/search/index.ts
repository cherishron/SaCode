/**
 * 代码搜索模块
 *
 * 提供基于 ripgrep 的代码搜索能力
 */

import type { ToolDefinition } from "../types";
import type { SearchCapabilityConfig } from "../types";
import { createGrepTool } from "./ripgrep";

/**
 * 创建搜索工具
 */
export function createSearchTools(config: SearchCapabilityConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  if (!config.enabled) {
    return tools;
  }

  // grep_tool
  tools.push(createGrepTool(config));

  return tools;
}