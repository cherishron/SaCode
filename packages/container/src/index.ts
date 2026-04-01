/**
 * SaClaw Container Module
 *
 * 提供容器管理、沙箱配置和资源监控功能。
 *
 * @module @saclaw/container
 */

// ============================================================================
// Types
// ============================================================================

export type {
  ContainerRuntime,
  ContainerState,
  ContainerConfig,
  ContainerInfo,
  ContainerExecResult,
  ContainerLog,
  Logger,
  ContainerManagerOptions,
  CreateContainerManagerOptions,
} from "./types.js";

export {
  ContainerRuntimeSchema,
  ContainerStateSchema,
  ContainerConfigSchema,
  ContainerInfoSchema,
  ContainerExecResultSchema,
  ContainerLogSchema,
} from "./types.js";

// ============================================================================
// Errors
// ============================================================================

export {
  ContainerError,
  ContainerNotFoundError,
  ContainerRuntimeError,
  ContainerTimeoutError,
} from "./errors.js";

// ============================================================================
// Classes
// ============================================================================

export { DockerRunner } from "./docker-runner.js";
export { Container } from "./container-instance.js";
export { ContainerManager, createContainerManager } from "./manager.js";

// Import for default export
import { ContainerManager } from "./manager.js";
import { Container } from "./container-instance.js";
import { DockerRunner } from "./docker-runner.js";
import { createContainerManager } from "./manager.js";

// ============================================================================
// Submodules
// ============================================================================

export * from "./sandbox.js";
export * from "./agent.js";
export * from "./monitor.js";

// ============================================================================
// Default exports
// ============================================================================

export default {
  ContainerManager,
  Container,
  DockerRunner,
  createContainerManager,
};