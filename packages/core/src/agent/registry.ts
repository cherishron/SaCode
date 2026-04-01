/**
 * Agent 注册表
 *
 * 管理可用 Agent 的注册、查找和生命周期
 */

import EventEmitter from "eventemitter3";
import type {
  Agent,
  AgentConfig,
  AgentStatus,
  AgentType,
} from "./types";

// ============================================================================
// Agent 注册表事件
// ============================================================================

export interface AgentRegistryEvents {
  /** Agent 注册 */
  agent_registered: (agent: Agent) => void;
  /** Agent 注销 */
  agent_unregistered: (agentId: string) => void;
  /** Agent 状态变更 */
  agent_status_changed: (agentId: string, status: AgentStatus) => void;
}

// ============================================================================
// Agent 注册表配置
// ============================================================================

export interface AgentRegistryConfig {
  /** 最大 Agent 数量 */
  maxAgents?: number;
  /** 默认 Agent 超时 */
  defaultTimeout?: number;
  /** 默认最大迭代次数 */
  defaultMaxIterations?: number;
  /** 调试模式 */
  debug?: boolean;
}

// ============================================================================
// Agent 注册表实现
// ============================================================================

/**
 * Agent 注册表
 *
 * 管理所有注册的 Agent，提供查找和状态管理功能
 */
export class AgentRegistry extends EventEmitter<AgentRegistryEvents> {
  private agents: Map<string, Agent> = new Map();
  private config: Required<AgentRegistryConfig>;

  constructor(config: AgentRegistryConfig = {}) {
    super();
    this.config = {
      maxAgents: config.maxAgents ?? 100,
      defaultTimeout: config.defaultTimeout ?? 60000,
      defaultMaxIterations: config.defaultMaxIterations ?? 10,
      debug: config.debug ?? false,
    };

    // 注册默认 Agent
    this.registerDefaultAgents();
  }

  // ============================================================================
  // Agent 注册/注销
  // ============================================================================

  /**
   * 注册 Agent
   */
  register(config: AgentConfig): Agent {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error(`Maximum agent limit reached (${this.config.maxAgents})`);
    }

    if (this.agents.has(config.id)) {
      throw new Error(`Agent with id "${config.id}" already exists`);
    }

    const agent: Agent = {
      config: {
        ...config,
        timeout: config.timeout ?? this.config.defaultTimeout,
        maxIterations: config.maxIterations ?? this.config.defaultMaxIterations,
        priority: config.priority ?? 0,
      },
      status: "idle",
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };

    this.agents.set(config.id, agent);
    this.emit("agent_registered", agent);

    if (this.config.debug) {
      console.log(`[AgentRegistry] Registered agent: ${config.id} (${config.type})`);
    }

    return agent;
  }

  /**
   * 注销 Agent
   */
  unregister(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    this.agents.delete(agentId);
    this.emit("agent_unregistered", agentId);

    if (this.config.debug) {
      console.log(`[AgentRegistry] Unregistered agent: ${agentId}`);
    }

    return true;
  }

  // ============================================================================
  // Agent 查询
  // ============================================================================

  /**
   * 获取 Agent
   */
  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 检查 Agent 是否存在
   */
  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * 获取所有 Agent
   */
  getAll(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 按类型获取 Agent
   */
  getByType(type: AgentType): Agent[] {
    return this.getAll().filter((agent) => agent.config.type === type);
  }

  /**
   * 按状态获取 Agent
   */
  getByStatus(status: AgentStatus): Agent[] {
    return this.getAll().filter((agent) => agent.status === status);
  }

  /**
   * 获取空闲 Agent
   */
  getIdleAgents(): Agent[] {
    return this.getByStatus("idle");
  }

  /**
   * 获取最适合执行任务的 Agent
   */
  getBestAgent(
    requiredTools?: string[],
    preferredType?: AgentType
  ): Agent | undefined {
    let candidates = this.getIdleAgents();

    // 按类型过滤
    if (preferredType) {
      const typeMatch = candidates.filter((a) => a.config.type === preferredType);
      if (typeMatch.length > 0) {
        candidates = typeMatch;
      }
    }

    // 按工具能力过滤
    if (requiredTools && requiredTools.length > 0) {
      candidates = candidates.filter((agent) => {
        const allowedTools = agent.config.allowedTools;
        if (!allowedTools) return true; // 无限制
        return requiredTools.every((tool) => allowedTools.includes(tool));
      });
    }

    // 按优先级排序
    candidates.sort((a, b) => (b.config.priority ?? 0) - (a.config.priority ?? 0));

    return candidates[0];
  }

  // ============================================================================
  // Agent 状态管理
  // ============================================================================

  /**
   * 更新 Agent 状态
   */
  updateStatus(agentId: string, status: AgentStatus): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    agent.status = status;
    agent.lastActiveAt = new Date();
    this.emit("agent_status_changed", agentId, status);

    if (this.config.debug) {
      console.log(`[AgentRegistry] Agent ${agentId} status: ${status}`);
    }

    return true;
  }

  /**
   * 标记 Agent 为忙碌
   */
  markBusy(agentId: string): boolean {
    return this.updateStatus(agentId, "executing");
  }

  /**
   * 标记 Agent 为空闲
   */
  markIdle(agentId: string): boolean {
    return this.updateStatus(agentId, "idle");
  }

  // ============================================================================
  // 统计信息
  // ============================================================================

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    byStatus: Record<AgentStatus, number>;
    byType: Record<AgentType, number>;
  } {
    const agents = this.getAll();

    const byStatus: Record<AgentStatus, number> = {
      idle: 0,
      planning: 0,
      executing: 0,
      waiting: 0,
      completed: 0,
      failed: 0,
    };

    const byType: Record<AgentType, number> = {
      general: 0,
      code: 0,
      research: 0,
      analysis: 0,
      creative: 0,
      execution: 0,
    };

    for (const agent of agents) {
      byStatus[agent.status]++;
      byType[agent.config.type]++;
    }

    return {
      total: agents.length,
      byStatus,
      byType,
    };
  }

  // ============================================================================
  // 默认 Agent
  // ============================================================================

  /**
   * 注册默认 Agent
   */
  private registerDefaultAgents(): void {
    // 通用 Agent
    this.register({
      id: "general-default",
      type: "general",
      name: "General Agent",
      description: "A general-purpose agent that can handle various tasks",
      systemPrompt: "You are a helpful AI assistant capable of handling various tasks.",
      priority: 1,
      tags: ["general", "default"],
    });

    // 代码 Agent
    this.register({
      id: "code-default",
      type: "code",
      name: "Code Agent",
      description: "An agent specialized in code-related tasks",
      systemPrompt: "You are a code expert. Help users with coding tasks, debugging, and code review.",
      allowedTools: [
        "read_file", "write_file", "execute_command",
        "search_files", "list_directory",
      ],
      priority: 10,
      tags: ["code", "development"],
    });

    // 研究 Agent
    this.register({
      id: "research-default",
      type: "research",
      name: "Research Agent",
      description: "An agent specialized in research and information gathering",
      systemPrompt: "You are a research assistant. Help users gather and analyze information.",
      priority: 5,
      tags: ["research", "information"],
    });

    // 执行 Agent
    this.register({
      id: "execution-default",
      type: "execution",
      name: "Execution Agent",
      description: "An agent specialized in executing tasks and commands",
      systemPrompt: "You are an execution agent. Execute tasks efficiently and report results.",
      allowedTools: [
        "execute_command", "browser_navigate", "browser_click",
        "browser_screenshot",
      ],
      priority: 8,
      tags: ["execution", "automation"],
    });
  }

  /**
   * 清除所有 Agent
   */
  clear(): void {
    this.agents.clear();
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Agent 注册表
 */
export function createAgentRegistry(config?: AgentRegistryConfig): AgentRegistry {
  return new AgentRegistry(config);
}
