/**
 * Ultrawork 模块
 *
 * 基于 OMO (Oh My OpenCode) 设计的自动化执行系统
 * 
 * 包含：
 * - TodoEnforcer: 任务强制器，确保任务有明确的 todo 列表并强制执行
 * - IntentGate: 意图门控，验证 Agent 的意图是否与任务一致
 * - RalphLoop: 循环执行引擎，自动迭代执行直到任务完成
 * - StateStore: 状态持久化存储，支持中断恢复
 */

// TodoEnforcer
export {
  TodoEnforcer,
  createTodoEnforcer,
} from "./todo-enforcer";
export type {
  TodoStatus,
  TodoItem,
  TodoValidationResult,
  TodoIssue,
  TodoEnforcerEvents,
  TodoEnforcerConfig,
} from "./todo-enforcer";

// IntentGate
export {
  IntentGate,
  createIntentGate,
} from "./intent-gate";
export type {
  IntentVerdict,
  IntentCheckResult,
  ActionRecord,
  IntentGateEvents,
  IntentGateConfig,
  TaskContext,
  LowConfidenceRecord,
  DriftDetectionResult,
} from "./intent-gate";

// RalphLoop
export {
  RalphLoop,
  createRalphLoop,
} from "./ralph-loop";
export type {
  LoopState,
  StepOutcome,
  LoopIteration,
  LazyDetection,
  RalphLoopEvents,
  RalphLoopConfig,
  RalphLoopSummary,
} from "./ralph-loop";

// StateStore
export {
  MemoryStateStore,
  FileStateStore,
  createStateStore,
  generateSnapshotId,
  serializeIteration,
  deserializeIteration,
} from "./state-store";
export type {
  IStateStore,
  StateStoreConfig,
  RalphLoopSnapshot,
  SerializedIteration,
} from "./state-store";
