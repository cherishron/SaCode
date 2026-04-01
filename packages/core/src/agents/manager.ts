/**
 * Specialist Agents 管理器
 *
 * 管理所有专家 Agent 的创建、执行和委派
 * 基于 OMO (Oh My OpenCode) 设计
 */

import EventEmitter from "eventemitter3";
import type {
  SpecialistRole,
  SpecialistAgent,
  SpecialistAgentConfig,
  DelegationRequest,
  DelegationResponse,
} from "./types";
import {
  DefaultSpecialistConfigs,
  createSpecialistAgent,
} from "./types";
import type { AgentChannel } from "../agent/communication";
import type { TaskCategory } from "../agent/types";

// ============================================
// 类型定义
// ============================================

/**
 * Agents 管理器事件
 */
export interface AgentsManagerEvents {
  /** Agent 创建 */
  agent_created: (agent: SpecialistAgent) => void;
  /** Agent 开始工作 */
  agent_started: (agent: SpecialistAgent, task: string) => void;
  /** Agent 完成工作 */
  agent_completed: (agent: SpecialistAgent, result: string) => void;
  /** Agent 失败 */
  agent_failed: (agent: SpecialistAgent, error: string) => void;
  /** 委派请求 */
  delegation_requested: (request: DelegationRequest) => void;
  /** 委派响应 */
  delegation_responded: (response: DelegationResponse) => void;
  /** 工具权限拒绝 */
  tool_permission_denied: (role: SpecialistRole, tool: string, reason: string) => void;
  /** 错误 */
  error: (error: Error, context?: unknown) => void;
}

/**
 * 任务分配策略
 */
export type TaskAssignmentStrategy =
  | "capability"     // 按能力匹配
  | "load-balance"   // 负载均衡
  | "round-robin"    // 轮询
  | "priority";      // 优先级

/**
 * Agents 管理器配置
 */
export interface AgentsManagerConfig {
  /** 任务分配策略 */
  assignmentStrategy: TaskAssignmentStrategy;
  /** 最大并行 Agent 数 */
  maxParallelAgents: number;
  /** 默认超时 */
  defaultTimeout: number;
  /** 是否启用自动委派 */
  enableAutoDelegation: boolean;
  /** 委派超时 */
  delegationTimeout: number;
}

// ============================================
// 任务分配映射
// ============================================

/**
 * 任务类型到专家 Agent 的映射
 */
const TaskToAgentMap: Record<string, SpecialistRole[]> = {
  // 代码实现
  "implement": ["hephaestus", "sisyphus"],
  "develop": ["hephaestus", "sisyphus"],
  "build": ["hephaestus", "sisyphus"],
  "create": ["hephaestus", "sisyphus"],
  
  // 规划
  "plan": ["prometheus", "sisyphus"],
  "design": ["prometheus", "oracle"],
  "strategy": ["prometheus", "sisyphus"],
  
  // 调试/分析
  "debug": ["oracle", "hephaestus"],
  "analyze": ["oracle", "prometheus"],
  "review": ["oracle", "securityauditor"],
  
  // 搜索/探索/文档
  "search": ["scout"],
  "find": ["scout"],
  "explore": ["scout"],
  "navigate": ["scout"],
  "document": ["scout"],
  "read": ["scout"],
  
  // 测试
  "test": ["tester"],
  "testing": ["tester"],
  "unittest": ["tester"],
  "coverage": ["tester"],
  
  // 安全
  "security": ["securityauditor"],
  "audit": ["securityauditor"],
  "vulnerability": ["securityauditor"],
  
  // 编排
  "orchestrate": ["sisyphus"],
  "coordinate": ["sisyphus"],
  "delegate": ["sisyphus"],
};

/**
 * 任务类别到专家 Agent 的映射
 */
const CategoryToAgentMap: Record<TaskCategory, SpecialistRole[]> = {
  "visual-engineering": ["hephaestus", "sisyphus"],
  "deep": ["hephaestus", "sisyphus"],
  "quick": ["scout"],
  "ultrabrain": ["prometheus", "oracle", "sisyphus"],
};

// ============================================
// AgentsManager 实现
// ============================================

/**
 * 专家 Agents 管理器
 */
export class AgentsManager extends EventEmitter<AgentsManagerEvents> {
  private agents: Map<SpecialistRole, SpecialistAgent> = new Map();
  private channel?: AgentChannel;
  private config: Required<AgentsManagerConfig>;
  private requestCounter = 0;

  constructor(config: Partial<AgentsManagerConfig> = {}) {
    super();
    this.config = {
      assignmentStrategy: config.assignmentStrategy ?? "capability",
      maxParallelAgents: config.maxParallelAgents ?? 5,
      defaultTimeout: config.defaultTimeout ?? 300000,
      enableAutoDelegation: config.enableAutoDelegation ?? true,
      delegationTimeout: config.delegationTimeout ?? 60000,
    };

    // 初始化所有专家 Agent
    this.initializeAgents();
  }

  // ============================================
  // 初始化
  // ============================================

  /**
   * 初始化所有专家 Agent
   */
  private initializeAgents(): void {
    for (const role of Object.keys(DefaultSpecialistConfigs) as SpecialistRole[]) {
      const agent = createSpecialistAgent(role);
      this.agents.set(role, agent);
      this.emit("agent_created", agent);
    }
  }

  /**
   * 设置通信通道
   */
  setChannel(channel: AgentChannel): void {
    this.channel = channel;

    // 为每个 Agent 注册消息处理器
    for (const [role] of this.agents) {
      channel.registerHandler({
        agentId: role,
        handler: async (message) => {
          return this.handleAgentMessage(role, message);
        },
        priority: 10,
      });
    }
  }

  // ============================================
  // Agent 管理
  // ============================================

  /**
   * 获取 Agent
   */
  getAgent(role: SpecialistRole): SpecialistAgent | undefined {
    return this.agents.get(role);
  }

  /**
   * 获取所有 Agent
   */
  getAllAgents(): SpecialistAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取空闲的 Agent
   */
  getIdleAgents(): SpecialistAgent[] {
    return this.getAllAgents().filter((a) => a.state.status === "idle");
  }

  /**
   * 获取工作中的 Agent
   */
  getWorkingAgents(): SpecialistAgent[] {
    return this.getAllAgents().filter((a) => a.state.status === "working");
  }

  /**
   * 更新 Agent 配置
   */
  updateAgentConfig(role: SpecialistRole, config: Partial<SpecialistAgentConfig>): boolean {
    const agent = this.agents.get(role);
    if (!agent) return false;

    agent.config = { ...agent.config, ...config };
    return true;
  }

  // ============================================
  // 任务分配
  // ============================================

  /**
   * 分配任务给最适合的 Agent
   */
  assignTask(
    task: string,
    category?: TaskCategory
  ): SpecialistAgent | undefined {
    // 根据任务类型或类别选择 Agent
    const candidates = this.selectCandidateAgents(task, category);
    if (candidates.length === 0) {
      return undefined;
    }

    // 根据策略选择
    const selected = this.applyAssignmentStrategy(candidates);

    return selected;
  }

  /**
   * 选择候选 Agent
   */
  private selectCandidateAgents(
    task: string,
    category?: TaskCategory
  ): SpecialistAgent[] {
    let candidateRoles: SpecialistRole[] = [];

    // 1. 如果提供了类别，使用类别映射
    if (category) {
      candidateRoles = CategoryToAgentMap[category] ?? [];
    }

    // 2. 根据任务关键词选择
    const lowerTask = task.toLowerCase();
    for (const [keyword, roles] of Object.entries(TaskToAgentMap)) {
      if (lowerTask.includes(keyword)) {
        candidateRoles = [...candidateRoles, ...roles];
      }
    }

    // 3. 去重
    candidateRoles = [...new Set(candidateRoles)];

    // 4. 如果没有匹配，使用 Sisyphus 作为默认
    if (candidateRoles.length === 0) {
      candidateRoles = ["sisyphus"];
    }

    // 5. 转换为 Agent 实例，过滤空闲的
    return candidateRoles
      .map((role) => this.agents.get(role))
      .filter((agent): agent is SpecialistAgent => 
        agent !== undefined && agent.state.status === "idle"
      );
  }

  /**
   * 应用分配策略
   */
  private applyAssignmentStrategy(candidates: SpecialistAgent[]): SpecialistAgent {
    if (candidates.length === 0) {
      throw new Error("No candidates available");
    }

    switch (this.config.assignmentStrategy) {
      case "load-balance":
        // 选择当前迭代次数最少的
        return candidates.reduce((prev, curr) =>
          curr.state.iterationCount < prev.state.iterationCount ? curr : prev
        );

      case "round-robin":
        // 随机选择
        return candidates[Math.floor(Math.random() * candidates.length)] ?? candidates[0]!;

      case "priority":
        // 选择优先级最高的（Sisyphus 优先）
        const priorityOrder: SpecialistRole[] = ["sisyphus", "hephaestus", "prometheus", "oracle", "scout", "tester", "securityauditor"];
        for (const role of priorityOrder) {
          const found = candidates.find((a) => a.config.role === role);
          if (found) return found;
        }
        return candidates[0]!;

      case "capability":
      default:
        // 默认选择第一个
        return candidates[0]!;
    }
  }

  // ============================================
  // Agent 执行
  // ============================================

  /**
   * 让 Agent 开始工作
   */
  async startAgent(
    role: SpecialistRole,
    task: string,
    _context?: Record<string, unknown>
  ): Promise<void> {
    const agent = this.agents.get(role);
    if (!agent) {
      throw new Error(`Agent not found: ${role}`);
    }

    if (agent.state.status === "working") {
      throw new Error(`Agent ${role} is already working`);
    }

    // 更新状态
    agent.state.status = "working";
    agent.state.currentTask = task;
    agent.state.startTime = new Date();
    agent.state.iterationCount++;

    this.emit("agent_started", agent, task);

    // 如果配置了通信通道，发送任务消息
    if (this.channel && agent.config.canDelegate) {
      // Agent 可以委派子任务
    }
  }

  /**
   * 让 Agent 完成工作
   */
  completeAgent(role: SpecialistRole, result: string): void {
    const agent = this.agents.get(role);
    if (!agent) return;

    agent.state.status = "completed";
    agent.state.endTime = new Date();
    agent.state.result = result;
    delete agent.state.currentTask;

    this.emit("agent_completed", agent, result);
  }

  /**
   * 让 Agent 失败
   */
  failAgent(role: SpecialistRole, error: string): void {
    const agent = this.agents.get(role);
    if (!agent) return;

    agent.state.status = "failed";
    agent.state.endTime = new Date();
    agent.state.error = error;
    delete agent.state.currentTask;

    this.emit("agent_failed", agent, error);
  }

  /**
   * 重置 Agent 状态
   */
  resetAgent(role: SpecialistRole): void {
    const agent = this.agents.get(role);
    if (!agent) return;

    agent.state = {
      status: "idle",
      iterationCount: 0,
      delegationCount: 0,
    };
  }

  // ============================================
  // 委派系统
  // ============================================

  /**
   * 请求委派
   */
  async requestDelegation(request: Omit<DelegationRequest, "id">): Promise<DelegationResponse> {
    const fullRequest: DelegationRequest = {
      ...request,
      id: `delegation_${Date.now()}_${++this.requestCounter}`,
    };

    this.emit("delegation_requested", fullRequest);

    // 检查目标 Agent 是否可用
    const targetAgent = this.agents.get(request.to);
    if (!targetAgent) {
      return {
        requestId: fullRequest.id,
        accepted: false,
        rejectionReason: `Agent not found: ${request.to}`,
      };
    }

    if (targetAgent.state.status !== "idle") {
      return {
        requestId: fullRequest.id,
        accepted: false,
        rejectionReason: `Agent ${request.to} is not available (status: ${targetAgent.state.status})`,
      };
    }

    // 更新委派计数
    const sourceAgent = this.agents.get(request.from);
    if (sourceAgent) {
      sourceAgent.state.delegationCount++;
    }

    // 接受委派
    const response: DelegationResponse = {
      requestId: fullRequest.id,
      accepted: true,
    };

    this.emit("delegation_responded", response);

    return response;
  }

  /**
   * 处理 Agent 消息
   */
  private async handleAgentMessage(
    role: SpecialistRole,
    message: { type: string; content: string; from?: string }
  ): Promise<unknown> {
    const agent = this.agents.get(role);
    if (!agent) return undefined;

    // 根据消息类型处理
    switch (message.type) {
      case "task":
        // 处理任务消息
        return this.handleTask(role, message.content);

      case "query":
        // 处理查询消息
        return this.handleQuery(role, message.content);

      case "delegation":
        // 处理委派请求
        return this.handleDelegation(role, message.content);

      default:
        return undefined;
    }
  }

  /**
   * 处理任务
   */
  private handleTask(role: SpecialistRole, task: string): unknown {
    // 启动 Agent 处理任务
    this.startAgent(role, task);
    return { status: "started", task };
  }

  /**
   * 处理查询
   */
  private handleQuery(role: SpecialistRole, _query: string): unknown {
    const agent = this.agents.get(role);
    if (!agent) return undefined;

    // 返回 Agent 状态和配置信息
    return {
      role,
      status: agent.state.status,
      capabilities: agent.config.allowedTools,
    };
  }

  /**
   * 处理委派请求
   */
  private async handleDelegation(_role: SpecialistRole, content: string): Promise<unknown> {
    try {
      const request = JSON.parse(content) as DelegationRequest;
      return this.requestDelegation(request);
    } catch {
      return { error: "Invalid delegation request format" };
    }
  }

  // ============================================
  // 批量操作
  // ============================================

  /**
   * 并行启动多个 Agent
   */
  async startParallel(
    tasks: Array<{ role: SpecialistRole; task: string; context?: Record<string, unknown> }>
  ): Promise<void> {
    const limited = tasks.slice(0, this.config.maxParallelAgents);

    await Promise.all(
      limited.map(({ role, task, context }) =>
        this.startAgent(role, task, context)
      )
    );
  }

  /**
   * 停止所有 Agent
   */
  stopAll(): void {
    for (const agent of this.agents.values()) {
      if (agent.state.status === "working") {
        agent.state.status = "idle";
        delete agent.state.currentTask;
      }
    }
  }

  /**
   * 重置所有 Agent
   */
  resetAll(): void {
    for (const role of this.agents.keys()) {
      this.resetAgent(role);
    }
  }

  // ============================================
  // 工具权限检查
  // ============================================

  /**
   * 检查 Agent 是否有权限使用指定工具
   */
  checkToolPermission(role: SpecialistRole, tool: string): {
    allowed: boolean;
    reason?: string | undefined;
    suggestedDelegate?: SpecialistRole | undefined;
  } {
    const agent = this.agents.get(role);
    if (!agent) {
      return { allowed: false, reason: `Agent not found: ${role}` };
    }

    const config = agent.config;

    // 检查是否在禁用列表中
    if (config.disabledTools?.includes(tool)) {
      const suggestedDelegate = this.suggestDelegateForTool(tool);
      this.emit("tool_permission_denied", role, tool, `Tool "${tool}" is disabled for ${role}`);
      
      return {
        allowed: false,
        reason: `Tool "${tool}" is disabled for ${role}. ${suggestedDelegate ? `Delegate to ${suggestedDelegate} instead.` : ""}`,
        suggestedDelegate: suggestedDelegate as SpecialistRole | undefined,
      };
    }

    // 检查是否在允许列表中
    if (config.allowedTools.includes("*")) {
      return { allowed: true };
    }

    if (config.allowedTools.includes(tool)) {
      return { allowed: true };
    }

    // 工具不在允许列表中
    const suggestedDelegate = this.suggestDelegateForTool(tool);
    this.emit("tool_permission_denied", role, tool, `Tool "${tool}" is not allowed for ${role}`);
    
    return {
      allowed: false,
      reason: `Tool "${tool}" is not allowed for ${role}. ${suggestedDelegate ? `Delegate to ${suggestedDelegate} instead.` : ""}`,
      suggestedDelegate: suggestedDelegate as SpecialistRole | undefined,
    };
  }

  /**
   * 为特定工具建议合适的委派目标
   */
  private suggestDelegateForTool(tool: string): SpecialistRole | undefined {
    // 写文件或执行命令 -> Hephaestus
    if (["write_file", "execute_command", "delete_file", "edit_file"].includes(tool)) {
      return "hephaestus";
    }
    
    // 规划相关 -> Prometheus
    if (["create_plan", "interview"].includes(tool)) {
      return "prometheus";
    }
    
    // 搜索相关 -> Scout
    if (tool.startsWith("search") || tool.startsWith("find")) {
      return "scout";
    }
    
    // 测试相关 -> Tester
    if (tool.startsWith("test") || tool === "write_test" || tool === "run_test") {
      return "tester";
    }
    
    // 安全审计相关 -> SecurityAuditor
    if (tool.startsWith("audit") || tool === "check_security" || tool === "scan_vulnerability") {
      return "securityauditor";
    }

    return undefined;
  }

  /**
   * 验证并获取可执行的工具列表
   */
  getAllowedToolsForAgent(role: SpecialistRole): string[] {
    const agent = this.agents.get(role);
    if (!agent) return [];

    const config = agent.config;
    
    if (config.allowedTools.includes("*")) {
      // 如果允许所有工具，排除禁用的
      return ["*"].filter(t => !config.disabledTools?.includes(t));
    }

    // 返回允许但未被禁用的工具
    return config.allowedTools.filter(t => !config.disabledTools?.includes(t));
  }

  /**
   * 获取 Agent 的禁用工具列表
   */
  getDisabledToolsForAgent(role: SpecialistRole): string[] {
    const agent = this.agents.get(role);
    return agent?.config.disabledTools ?? [];
  }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 Agents 管理器
 */
export function createAgentsManager(
  config?: Partial<AgentsManagerConfig>
): AgentsManager {
  return new AgentsManager(config);
}
