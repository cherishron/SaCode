/**
 * 工具桥接层类型定义
 *
 * 统一 Provider 工具、Capabilities 工具和 MCP 工具的类型系统
 */

import type { ToolDefinition as ProviderToolDefinition, ToolCall, ToolCallResult } from "../provider";

// ============================================================================
// 通用工具定义
// ============================================================================

/**
 * 工具参数 Schema（简化版，兼容 Zod 和 JSON Schema）
 */
export interface ToolParameterSchema {
  type: string;
  description?: string;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  items?: ToolParameterSchema;
  enum?: string[];
  default?: unknown;
  [key: string]: unknown;
}

/**
 * 统一工具定义
 */
export interface UnifiedToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数 Schema */
  parameters: ToolParameterSchema;
  /** 工具来源 */
  source: "builtin" | "capabilities" | "mcp" | "custom";
  /** 是否危险操作 */
  dangerous?: boolean;
  /** 需要确认 */
  requiresConfirmation?: boolean;
  /** 执行处理器 */
  handler?: ToolHandler;
}

/**
 * 工具处理函数
 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

// ============================================================================
// 工具来源类型
// ============================================================================

/**
 * Capabilities 工具定义（来自 @saclaw/capabilities）
 */
export interface CapabilitiesToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    _def?: unknown;
    shape?: () => Record<string, unknown>;
    [key: string]: unknown;
  };
  execute: (input: unknown) => Promise<unknown>;
}

/**
 * MCP 工具定义
 */
export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
  success: boolean;
  content: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// ToolBridge 配置
// ============================================================================

/**
 * 工具桥接层配置
 */
export interface ToolBridgeConfig {
  /** 是否启用内置工具 */
  enableBuiltinTools?: boolean;
  /** 是否启用 Capabilities 工具 */
  enableCapabilities?: boolean;
  /** 是否启用 MCP 工具 */
  enableMCP?: boolean;
  /** Capabilities 工具注册表引用 */
  capabilitiesRegistry?: CapabilitiesRegistryLike | null;
  /** MCP 客户端引用 */
  mcpClients?: Map<string, MCPClientLike> | null;
  /** 最大并行工具调用数 */
  maxParallelCalls?: number;
  /** 工具执行超时 */
  executionTimeout?: number;
  /** 调试模式 */
  debug?: boolean;
}

/**
 * Capabilities 注册表接口（简化版）
 */
export interface CapabilitiesRegistryLike {
  list(): CapabilitiesToolDefinition[];
  execute(name: string, input: unknown): Promise<unknown>;
  has(name: string): boolean;
}

/**
 * MCP 客户端接口（简化版）
 */
export interface MCPClientLike {
  listTools(): Promise<MCPToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown }>;
}

// ============================================================================
// 工具事件
// ============================================================================

/**
 * 工具桥接层事件
 */
export interface ToolBridgeEvents {
  /** 工具注册 */
  tool_registered: (tool: UnifiedToolDefinition) => void;
  /** 工具注销 */
  tool_unregistered: (name: string) => void;
  /** 工具调用开始 */
  tool_call_start: (call: ToolCall) => void;
  /** 工具调用结束 */
  tool_call_end: (result: ToolCallResult) => void;
  /** 错误 */
  error: (error: Error) => void;
}

// ============================================================================
// 工具编排
// ============================================================================

/**
 * 工具调用计划
 */
export interface ToolCallPlan {
  /** 计划 ID */
  id: string;
  /** 工具调用列表 */
  calls: ToolCall[];
  /** 是否并行执行 */
  parallel: boolean;
  /** 依赖关系 */
  dependencies?: Map<string, string[]>;
}

/**
 * 工具编排执行结果
 */
export interface ToolOrchestrationResult {
  /** 计划 ID */
  planId: string;
  /** 所有工具调用结果 */
  results: ToolCallResult[];
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

// ============================================================================
// 转换器接口
// ============================================================================

/**
 * 工具定义转换器
 */
export interface ToolDefinitionConverter<TInput> {
  /**
   * 将源工具定义转换为统一格式
   */
  convert(source: TInput): UnifiedToolDefinition;

  /**
   * 将统一格式转换为 Provider 格式
   */
  toProviderFormat(unified: UnifiedToolDefinition): ProviderToolDefinition;
}
