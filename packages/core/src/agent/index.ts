/**
 * Agent 模块
 *
 * 提供 Agentic 规划、Agent 注册和编排能力
 * 
 * 基于 OMO (Oh My OpenCode) 设计：
 * - 多 Agent 编排
 * - Sisyphus 循环执行
 * - Agent-to-Agent 通信
 */

// 类型导出
export type {
  AgentType,
  AgentStatus,
  AgentConfig,
  Agent,
  StepStatus,
  TaskStep,
  ExecutionPlan,
  PlannerOptions,
  OrchestrationEventType,
  OrchestrationEvent,
  OrchestrationResult,
  OrchestratorConfig,
  AgentMessageType,
  AgentMessage,
  ComplexityLevel,
  ComplexityAssessment,
  TaskCategory,
} from "./types";

// Registry
export {
  AgentRegistry,
  createAgentRegistry,
} from "./registry";
export type { AgentRegistryEvents, AgentRegistryConfig } from "./registry";

// Planner
export {
  Planner,
  createPlanner,
} from "./planner";
export type { PlannerEvents } from "./planner";

// Orchestrator
export {
  Orchestrator,
  createOrchestrator,
} from "./orchestrator";
export type { OrchestratorEvents } from "./orchestrator";

// Communication (Agent-to-Agent)
export {
  AgentChannel,
  createAgentChannel,
} from "./communication";
export type {
  CommunicationEvents,
  MessageHandler,
  HandlerRegistration,
  RoutingStrategy,
  CommunicationConfig,
} from "./communication";

// Sisyphus Loop (Ultrawork)
export {
  SisyphusLoop,
  createSisyphusLoop,
} from "./sisyphus-loop";
export type {
  LoopMode,
  CompletionStatus,
  LazyDetectionResult,
  CompletionAssessment,
  SisyphusConfig,
  SisyphusEvents,
  SisyphusResult,
} from "./sisyphus-loop";
