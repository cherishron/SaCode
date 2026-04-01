/**
 * Agent 编排器
 *
 * 简化的 Agent 管理实现
 */

import type { ToolDefinition } from "../types";
import type { AgentToolInput, TeamCreateInput, TeamDeleteInput, AgentCapabilityConfig } from "../types";

/**
 * 模拟的 Agent 存储和团队存储
 */
const agentStore = new Map<string, {
  id: string;
  name: string;
  task: string;
  context: Record<string, unknown>;
  tools: string[];
  model: string;
  createdAt: Date;
}>();

const teamStore = new Map<string, {
  id: string;
  name: string;
  agents: Array<{
    name: string;
    role: string;
    model?: string;
    tools?: string[];
  }>;
  coordinationMode: "sequential" | "parallel" | "hierarchical";
  createdAt: Date;
}>();

/**
 * 创建 agent_tool 工具
 */
export function createAgentTool(config: AgentCapabilityConfig): ToolDefinition {
  return {
    name: "agent_tool",
    description: "创建并执行一个子 Agent 来处理特定任务",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "agentName" in input && "task" in input) {
          const parsed = input as AgentToolInput;

          if (typeof parsed.agentName !== "string" || parsed.agentName.length === 0) {
            throw new Error("AgentName must be a non-empty string");
          }

          if (typeof parsed.task !== "string" || parsed.task.length === 0) {
            throw new Error("Task must be a non-empty string");
          }

          return parsed;
        }
        throw new Error("Invalid input: expected AgentToolInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as AgentToolInput;

      // 检查 Agent 数量限制
      if (config.maxAgents && agentStore.size >= config.maxAgents) {
        throw new Error(`Maximum number of agents (${config.maxAgents}) reached`);
      }

      // 生成 Agent ID
      const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      // 创建 Agent
      const agent = {
        id: agentId,
        name: typedInput.agentName,
        task: typedInput.task,
        context: typedInput.context ?? {},
        tools: typedInput.tools ?? [],
        model: typedInput.model ?? "default",
        createdAt: new Date(),
      };

      // 存储 Agent
      agentStore.set(agentId, agent);

      // 模拟执行任务
      const result = {
        message: `Agent "${agent.name}" has completed the task`,
        taskId: typedInput.task,
        result: "Task executed successfully (simulated)",
      };

      // 格式化输出
      let output = `# 子 Agent 执行结果\n\n`;
      output += `**Agent ID**: ${agentId}\n`;
      output += `**Agent 名称**: ${agent.name}\n`;
      output += `**任务**: ${agent.task}\n`;
      output += `**模型**: ${agent.model}\n`;
      output += `**可用工具**: ${agent.tools.join(", ") || "无"}\n`;
      output += `**创建时间**: ${agent.createdAt.toISOString()}\n\n`;

      output += `## 执行结果\n\n`;
      output += JSON.stringify(result, null, 2);

      return output;
    },
  };
}

/**
 * 创建 team_create_tool 工具
 */
export function createTeamCreateTool(config: AgentCapabilityConfig): ToolDefinition {
  return {
    name: "team_create_tool",
    description: "创建一个由多个 Agent 组成的团队，支持串行、并行或层级协调模式",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "teamName" in input && "agents" in input) {
          const parsed = input as TeamCreateInput;

          if (typeof parsed.teamName !== "string" || parsed.teamName.length === 0) {
            throw new Error("TeamName must be a non-empty string");
          }

          if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) {
            throw new Error("Agents must be a non-empty array");
          }

          return parsed;
        }
        throw new Error("Invalid input: expected TeamCreateInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as TeamCreateInput;

      // 检查团队数量限制
      if (config.maxTeams && teamStore.size >= config.maxTeams) {
        throw new Error(`Maximum number of teams (${config.maxTeams}) reached`);
      }

      // 生成团队 ID
      const teamId = `team-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      // 创建团队
      const team = {
        id: teamId,
        name: typedInput.teamName,
        agents: typedInput.agents,
        coordinationMode: typedInput.coordinationMode ?? "sequential",
        createdAt: new Date(),
      };

      // 存储团队
      teamStore.set(teamId, team);

      // 格式化输出
      let output = `# 团队已创建\n\n`;
      output += `**团队 ID**: ${teamId}\n`;
      output += `**团队名称**: ${team.name}\n`;
      output += `**协调模式**: ${team.coordinationMode}\n`;
      output += `**Agent 数量**: ${team.agents.length}\n`;
      output += `**创建时间**: ${team.createdAt.toISOString()}\n\n`;

      output += `## Agent 列表\n\n`;
      for (let i = 0; i < team.agents.length; i++) {
        const agent = team.agents[i];
        if (!agent) continue;

        output += `### ${i + 1}. ${agent.name}\n\n`;
        output += `- **角色**: ${agent.role}\n`;
        if (agent.model) output += `- **模型**: ${agent.model}\n`;
        if (agent.tools) output += `- **工具**: ${agent.tools.join(", ")}\n`;
        output += "\n";
      }

      return output;
    },
  };
}

/**
 * 创建 team_delete_tool 工具
 */
export function createTeamDeleteTool(_config: AgentCapabilityConfig): ToolDefinition {
  return {
    name: "team_delete_tool",
    description: "删除指定的 Agent 团队",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "teamName" in input) {
          const parsed = input as TeamDeleteInput;

          if (typeof parsed.teamName !== "string" || parsed.teamName.length === 0) {
            throw new Error("TeamName must be a non-empty string");
          }

          return parsed;
        }
        throw new Error("Invalid input: expected TeamDeleteInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as TeamDeleteInput;

      // 查找团队
      let foundTeamId: string | null = null;
      for (const [id, team] of teamStore.entries()) {
        if (team.name === typedInput.teamName) {
          foundTeamId = id;
          break;
        }
      }

      if (!foundTeamId) {
        throw new Error(`Team not found: ${typedInput.teamName}`);
      }

      // 删除团队
      const team = teamStore.get(foundTeamId)!;
      teamStore.delete(foundTeamId);

      // 格式化输出
      let output = `# 团队已删除\n\n`;
      output += `**团队 ID**: ${foundTeamId}\n`;
      output += `**团队名称**: ${team.name}\n`;
      output += `**Agent 数量**: ${team.agents.length}\n`;
      output += `**删除时间**: ${new Date().toISOString()}\n`;

      return output;
    },
  };
}
