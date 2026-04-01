/**
 * Workspace 模块 - 工作空间管理
 *
 * 提供工作空间加载、模板管理、内存管理等功能
 */

export { WorkspaceManager, createWorkspaceManager } from "./manager.js";
export type {
  WorkspaceConfig,
  WorkspaceTemplate,
  WorkspaceFile,
  WorkspaceContext,
  WorkspaceManagerOptions,
  SandboxConfig,
  SandboxMode,
  ContainerConfig,
  ContainerExecResult,
  WorkspaceEvent,
} from "./types.js";

export { TemplateRegistry, createTemplateRegistry } from "./template.js";

export { MemoryLoader, createMemoryLoader } from "./memory.js";
export type { WorkspaceMemoryEntry as MemoryEntry, MemoryLoaderOptions } from "./memory.js";
