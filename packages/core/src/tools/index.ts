/**
 * 工具桥接层模块
 *
 * 统一管理 Provider 工具、Capabilities 工具和 MCP 工具
 */

// 类型导出
export type {
  UnifiedToolDefinition,
  ToolParameterSchema,
  ToolHandler,
  ToolExecutionResult,
  ToolBridgeConfig,
  ToolBridgeEvents,
  CapabilitiesToolDefinition,
  MCPToolDefinition,
  CapabilitiesRegistryLike,
  MCPClientLike,
  ToolCallPlan,
  ToolOrchestrationResult,
  ToolDefinitionConverter,
} from "./types";

// Bridge 导出
export { ToolBridge, createToolBridge } from "./bridge";

// Adapter 导出
export {
  zodToJsonSchema,
  CapabilitiesToolConverter,
  MCPToolConverter,
  convertCapabilitiesTools,
  convertMCPTools,
  toProviderToolDefinitions,
} from "./adapter";

// Builtin 导出
export {
  BUILTIN_TOOLS,
  getBuiltinToolNames,
  getBuiltinTool,
  isBuiltinTool,
} from "./builtin";

// MCP Adapter 导出
export {
  createMCPClientAdapter,
  createMCPClientAdapters,
} from "./mcp-adapter";

// Confirmation 导出
export {
  ToolConfirmationManager,
  createToolConfirmationManager,
  DANGEROUS_TOOLS,
  DANGEROUS_COMMANDS,
  DEFAULT_CONFIRMATION_CONFIG,
} from "./confirmation";
export type {
  ConfirmationMode,
  ConfirmationRequest,
  ConfirmationResponse,
  ConfirmationConfig,
  ConfirmationEvents,
} from "./confirmation";
