/**
 * Specialist Agents 模块
 *
 * 基于 OMO (Oh My OpenCode) 设计的多 Agent 系统
 * 
 * 包含：
 * - 7 个专业 Agent：Sisyphus, Hephaestus, Prometheus, Oracle, Scout, Tester, SecurityAuditor
 * - Agent 管理器和委派系统
 * - 任务分配和负载均衡
 */

// 类型导出
export type {
  SpecialistRole,
  AgentExecutionMode,
  SpecialistAgentConfig,
  SpecialistAgentState,
  SpecialistAgent,
  DelegationRequest,
  DelegationResponse,
} from "./types";

// 配置和工厂函数
export {
  DefaultSpecialistConfigs,
  getSpecialistConfig,
  createSpecialistAgent,
} from "./types";

// Agent 管理器
export {
  AgentsManager,
  createAgentsManager,
} from "./manager";
export type {
  AgentsManagerEvents,
  TaskAssignmentStrategy,
  AgentsManagerConfig,
} from "./manager";
