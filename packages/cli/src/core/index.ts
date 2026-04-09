/**
 * Core 模块导出
 */

// QueryEngine
export {
  QueryEngine,
  type QueryEngineState,
  type StreamEvent,
  type Message,
  type ToolRegistry,
  type MemoryManager as QueryMemoryManager,
  type QueryDeps,
  type QueryOptions,
  type TokenUsage,
} from "./QueryEngine.js";

// Memory
export {
  MemoryManager,
  createMemoryManager,
  getDefaultMemoryDir,
  type MemoryType,
  type MemoryEntry,
  type MemoryIndex,
  type MemoryManagerConfig,
} from "./memory.js";

// Compaction
export {
  CompactionEngine,
  estimateTokens,
  estimateTotalTokens,
  type CompactionLevel,
  type CompactionStrategy,
  type CompactionContext,
  type CompactionResult,
} from "./compaction.js";

// Coordinator
export {
  Coordinator,
  createCoordinator,
  type AgentType,
  type SubTask,
  type SubTaskResult,
  type CoordinatorPlan,
  type CoordinatorResult,
  type AgentExecutor,
  type CoordinatorConfig,
} from "./coordinator.js";

// Permissions
export {
  PermissionEngine,
  createPermissionEngine,
  DEFAULT_RULES,
  type PermissionLevel,
  type PermissionRule,
  type PermissionMode,
  type PermissionCheckResult,
  type PermissionEngineConfig,
} from "./permissions.js";

// Hook Engine
export { HookEngine, createHookEngine, type HookHandler, type HookEvent } from "./hooks.js";

// Context
export {
  ContextCollector,
  createContextCollector,
  type SystemContext,
  type UserContext,
  type ContextConfig,
} from "./context.js";

// Cost Tracker
export {
  CostTracker,
  createCostTracker,
  type CostEntry,
  type CostSummary,
  type CostConfig,
} from "./cost-tracker.js";
