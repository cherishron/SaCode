/**
 * Agent 管理模块
 *
 * 提供子 Agent 调用和团队管理能力
 */

import type { ToolDefinition } from "../types";
import type { AgentCapabilityConfig } from "../types";
import { createAgentTool, createTeamCreateTool, createTeamDeleteTool } from "./orchestrator";

/**
 * 创建 Agent 管理工具
 */
export function createAgentTools(config: AgentCapabilityConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  if (!config.enabled) {
    return tools;
  }

  // agent_tool
  tools.push(createAgentTool(config));

  // team_create_tool
  tools.push(createTeamCreateTool(config));

  // team_delete_tool
  tools.push(createTeamDeleteTool(config));

  return tools;
}