// Types
export * from "./types";

// Tools
export { ToolRegistry, CapabilitiesManager, defaultCapabilitiesConfig } from "./tools";

// File tools
export { createFileTools } from "./files";

// Browser tools
export { BrowserManager, createBrowserTools } from "./browser";

// Shell tools
export { createShellTools, clearVfoxCache, getVfoxStatus } from "./shell";

// Environment tools
export {
  getPlatformCommand,
  detectRuntime,
  detectRuntimePath,
  detectRuntimeFull,
  detectRuntimes,
  detectVfox,
  vfoxCurrent,
  vfoxGetPath,
  checkEnvironment,
  checkRequiredRuntimes,
  defaultEnvironmentCheckConfig,
} from "./environment";
export type { EnvironmentCheckConfig, EnvironmentCheckResult } from "./environment";

// Tool adapter for ToolBridge integration
export {
  zodSchemaToJson,
  defaultToolAdapter,
  createToolRegistryAdapter,
} from "./adapter";
export type { ProviderCompatibleTool, ToolAdapter } from "./adapter";
