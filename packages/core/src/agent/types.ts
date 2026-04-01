/**
 * Agent 系统类型定义
 *
 * 定义 Agentic 规划、Agent 注册和编排相关的类型
 */

// ============================================================================
// Agent 类型定义
// ============================================================================

/**
 * Agent 类型
 */
export type AgentType =
  | "general"        // 通用 Agent
  | "code"           // 代码 Agent
  | "research"       // 研究 Agent
  | "analysis"       // 分析 Agent
  | "creative"       // 创意 Agent
  | "execution";     // 执行 Agent

/**
 * Agent 状态
 */
export type AgentStatus =
  | "idle"           // 空闲
  | "planning"       // 规划中
  | "executing"      // 执行中
  | "waiting"        // 等待输入
  | "completed"      // 已完成
  | "failed";        // 失败

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** Agent 唯一标识 */
  id: string;
  /** Agent 类型 */
  type: AgentType;
  /** Agent 名称 */
  name: string;
  /** Agent 描述 */
  description?: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 允许使用的工具列表 */
  allowedTools?: string[];
  /** 最大迭代次数 */
  maxIterations?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 优先级（越高越优先） */
  priority?: number;
  /** 标签 */
  tags?: string[];
}

/**
 * Agent 实例
 */
export interface Agent {
  /** Agent 配置 */
  config: AgentConfig;
  /** 当前状态 */
  status: AgentStatus;
  /** 创建时间 */
  createdAt: Date;
  /** 最后活动时间 */
  lastActiveAt: Date;
}

// ============================================================================
// 规划类型定义
// ============================================================================

/**
 * 任务步骤状态
 */
export type StepStatus =
  | "pending"        // 待执行
  | "running"        // 执行中
  | "completed"      // 已完成
  | "failed"         // 失败
  | "skipped";       // 已跳过

/**
 * 任务步骤
 */
export interface TaskStep {
  /** 步骤 ID */
  id: string;
  /** 步骤描述 */
  description: string;
  /** 步骤状态 */
  status: StepStatus;
  /** 优先级 (0-100，数值越高优先级越高) */
  priority?: number;
  /** 依赖的步骤 ID */
  dependencies?: string[];
  /** 使用的工具 */
  tools?: string[];
  /** 预期输出 */
  expectedOutput?: string;
  /** 实际输出 */
  output?: string;
  /** 错误信息 */
  error?: string;
  /** 开始时间 */
  startedAt?: Date;
  /** 结束时间 */
  completedAt?: Date;
  /** 指派的 Agent */
  assignedAgent?: string;
}

/**
 * 执行计划
 */
export interface ExecutionPlan {
  /** 计划 ID */
  id: string;
  /** 计划描述 */
  description: string;
  /** 目标 */
  goal: string;
  /** 步骤列表 */
  steps: TaskStep[];
  /** 计划状态 */
  status: "draft" | "approved" | "executing" | "completed" | "failed";
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
  /** 完成时间 */
  completedAt?: Date;
  /** 上下文信息 */
  context?: Record<string, unknown>;
}

/**
 * 规划选项
 */
export interface PlannerOptions {
  /** 是否允许并行执行 */
  allowParallel?: boolean;
  /** 最大步骤数 */
  maxSteps?: number;
  /** 是否自动分配 Agent */
  autoAssignAgents?: boolean;
  /** 调试模式 */
  debug?: boolean;
}

// ============================================================================
// 编排类型定义
// ============================================================================

/**
 * 编排事件类型
 */
export type OrchestrationEventType =
  | "plan_created"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "agent_assigned"
  | "plan_completed"
  | "plan_failed";

/**
 * 编排事件
 */
export interface OrchestrationEvent {
  /** 事件类型 */
  type: OrchestrationEventType;
  /** 相关计划 ID */
  planId: string;
  /** 相关步骤 ID（可选） */
  stepId?: string;
  /** 相关 Agent ID（可选） */
  agentId?: string;
  /** 事件数据 */
  data?: unknown;
  /** 时间戳 */
  timestamp: Date;
}

/**
 * 编排结果
 */
export interface OrchestrationResult {
  /** 计划 ID */
  planId: string;
  /** 是否成功 */
  success: boolean;
  /** 完成的步骤数 */
  completedSteps: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 最终输出 */
  output?: string;
  /** 错误信息 */
  error?: string;
  /** 执行时间（毫秒） */
  duration: number;
}

/**
 * 编排器配置
 */
export interface OrchestratorConfig {
  /** 最大并行步骤数 */
  maxParallelSteps?: number;
  /** 步骤超时时间 */
  stepTimeout?: number;
  /** 重试次数 */
  maxRetries?: number;
  /** 是否在失败时继续 */
  continueOnFailure?: boolean;
  /** 调试模式 */
  debug?: boolean;
}

// ============================================================================
// Agent 通信类型
// ============================================================================

/**
 * Agent 消息类型
 */
export type AgentMessageType =
  | "task"           // 任务
  | "query"          // 查询
  | "response"       // 响应
  | "status"         // 状态更新
  | "error";         // 错误

/**
 * Agent 间消息
 */
export interface AgentMessage {
  /** 消息 ID */
  id: string;
  /** 发送方 Agent ID */
  from: string;
  /** 接收方 Agent ID */
  to: string;
  /** 消息类型 */
  type: AgentMessageType;
  /** 消息内容 */
  content: string;
  /** 相关计划 ID */
  planId?: string;
  /** 相关步骤 ID */
  stepId?: string;
  /** 时间戳 */
  timestamp: Date;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 复杂度评估类型
// ============================================================================

/**
 * 任务复杂度级别
 */
export type ComplexityLevel = "simple" | "medium" | "complex";

/**
 * 任务类别（基于 OMO 设计）
 *
 * - visual-engineering: 前端/UI/UX 任务
 * - deep: 自主研究+执行，深度代码工作
 * - quick: 单文件更改，快速任务
 * - ultrabrain: 硬逻辑/架构决策，复杂推理
 */
export type TaskCategory =
  | "visual-engineering"
  | "deep"
  | "quick"
  | "ultrabrain";

/**
 * 复杂度评估结果
 */
export interface ComplexityAssessment {
  /** 复杂度级别 */
  level: ComplexityLevel;
  /** 分数（0-100） */
  score: number;
  /** 任务类别（基于 OMO 设计） */
  taskCategory: TaskCategory;
  /** 推荐模型 ID */
  recommendedModel?: string;
  /** 因素分析 */
  factors: {
    /** 涉及的技术栈数量 */
    techStackCount: number;
    /** 需要的工具数量 */
    toolCount: number;
    /** 预估步骤数 */
    estimatedSteps: number;
    /** 是否需要外部资源 */
    requiresExternalResources: boolean;
    /** 是否需要用户交互 */
    requiresUserInteraction: boolean;
  };
  /** 建议 */
  recommendation?: string;
}
