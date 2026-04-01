/**
 * Hooks 系统入口
 *
 * 提供事件驱动的钩子机制，支持在关键操作前后执行自定义逻辑
 */

// 类型导出
export type {
  HookEvent,
  HookContext,
  HookResult,
  HookDefinition,
  HookRegisterOptions,
  HookStats,
  HookExecutionLog,
  HookManagerConfig,
  HookEventDataMap,
  EventData,
  HookFileMetadata,
} from "./types";

export { DEFAULT_HOOK_MANAGER_CONFIG } from "./types";

// 执行器导出
export { HookExecutor, createHookExecutor } from "./executor";
export type { HookExecutorConfig } from "./executor";

// 管理器导出
export { HookManager, createHookManager } from "./manager";

// 内置钩子导出
export * from "./builtin";
