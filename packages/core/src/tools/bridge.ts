/**
 * 工具桥接层
 *
 * 统一管理 Provider 工具、Capabilities 工具和 MCP 工具
 * 提供工具注册、转换、执行和编排能力
 */

import EventEmitter from "eventemitter3";
import type { ToolCall, ToolCallResult } from "../provider";
import type {
  UnifiedToolDefinition,
  ToolBridgeConfig,
  ToolBridgeEvents,
  ToolCallPlan,
  ToolOrchestrationResult,
  CapabilitiesRegistryLike,
  MCPClientLike,
} from "./types";
import { BUILTIN_TOOLS } from "./builtin";
import {
  convertCapabilitiesTools,
  convertMCPTools,
  toProviderToolDefinitions,
} from "./adapter";

// ============================================================================
// ToolBridge 类
// ============================================================================

/**
 * 工具桥接层
 *
 * 统一管理所有工具来源，提供统一的注册、转换和执行接口
 */
export class ToolBridge extends EventEmitter<ToolBridgeEvents> {
  private tools: Map<string, UnifiedToolDefinition> = new Map();
  private config: Required<Omit<ToolBridgeConfig, "capabilitiesRegistry" | "mcpClients">> & {
    capabilitiesRegistry: CapabilitiesRegistryLike | null;
    mcpClients: Map<string, MCPClientLike> | null;
  };
  private initialized = false;

  constructor(config: ToolBridgeConfig = {}) {
    super();
    this.config = {
      enableBuiltinTools: config.enableBuiltinTools ?? true,
      enableCapabilities: config.enableCapabilities ?? true,
      enableMCP: config.enableMCP ?? true,
      capabilitiesRegistry: config.capabilitiesRegistry ?? null,
      mcpClients: config.mcpClients ?? null,
      maxParallelCalls: config.maxParallelCalls ?? 5,
      executionTimeout: config.executionTimeout ?? 60000,
      debug: config.debug ?? false,
    };
  }

  // ============================================================================
  // 初始化
  // ============================================================================

  /**
   * 初始化工具桥接层
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // 1. 注册内置工具
    if (this.config.enableBuiltinTools) {
      this.registerBuiltinTools();
    }

    // 2. 注册 Capabilities 工具
    if (this.config.enableCapabilities && this.config.capabilitiesRegistry) {
      this.registerCapabilitiesTools();
    }

    // 3. 注册 MCP 工具
    if (this.config.enableMCP && this.config.mcpClients) {
      await this.registerMCPTools();
    }

    this.initialized = true;

    if (this.config.debug) {
      console.log(`[ToolBridge] Initialized with ${this.tools.size} tools`);
    }
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================================
  // 工具注册
  // ============================================================================

  /**
   * 注册单个工具
   */
  registerTool(tool: UnifiedToolDefinition): void {
    if (this.tools.has(tool.name)) {
      if (this.config.debug) {
        console.log(`[ToolBridge] Tool "${tool.name}" already registered, overwriting`);
      }
    }

    this.tools.set(tool.name, tool);
    this.emit("tool_registered", tool);

    if (this.config.debug) {
      console.log(`[ToolBridge] Registered tool: ${tool.name} (${tool.source})`);
    }
  }

  /**
   * 批量注册工具
   */
  registerTools(tools: UnifiedToolDefinition[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * 注销工具
   */
  unregisterTool(name: string): boolean {
    const deleted = this.tools.delete(name);
    if (deleted) {
      this.emit("tool_unregistered", name);
    }
    return deleted;
  }

  /**
   * 注册内置工具
   */
  private registerBuiltinTools(): void {
    for (const tool of BUILTIN_TOOLS) {
      this.registerTool(tool);
    }
  }

  /**
   * 注册 Capabilities 工具
   */
  private registerCapabilitiesTools(): void {
    if (!this.config.capabilitiesRegistry) {
      return;
    }

    try {
      const capabilitiesTools = this.config.capabilitiesRegistry.list();
      const unifiedTools = convertCapabilitiesTools(capabilitiesTools);

      for (const tool of unifiedTools) {
        // 注入执行器
        if (!tool.handler) {
          tool.handler = async (args: Record<string, unknown>) => {
            const result = await this.config.capabilitiesRegistry!.execute(tool.name, args);
            return typeof result === "string" ? result : JSON.stringify(result, null, 2);
          };
        }
        this.registerTool(tool);
      }

      if (this.config.debug) {
        console.log(`[ToolBridge] Registered ${unifiedTools.length} capabilities tools`);
      }
    } catch (error) {
      if (this.config.debug) {
        console.error("[ToolBridge] Failed to register capabilities tools:", error);
      }
    }
  }

  /**
   * 注册 MCP 工具
   */
  private async registerMCPTools(): Promise<void> {
    if (!this.config.mcpClients) {
      return;
    }

    for (const [serverName, client] of this.config.mcpClients) {
      try {
        const mcpTools = await client.listTools();
        const unifiedTools = convertMCPTools(mcpTools);

        for (const tool of unifiedTools) {
          // 注入执行器（通过 MCP 客户端调用）
          tool.handler = async (args: Record<string, unknown>) => {
            const result = await client.callTool(tool.name, args);
            return typeof result.content === "string"
              ? result.content
              : JSON.stringify(result.content, null, 2);
          };
          this.registerTool(tool);
        }

        if (this.config.debug) {
          console.log(`[ToolBridge] Registered ${unifiedTools.length} MCP tools from ${serverName}`);
        }
      } catch (error) {
        if (this.config.debug) {
          console.error(`[ToolBridge] Failed to register MCP tools from ${serverName}:`, error);
        }
      }
    }
  }

  // ============================================================================
  // 工具查询
  // ============================================================================

  /**
   * 获取工具
   */
  getTool(name: string): UnifiedToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 检查工具是否存在
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取所有工具名称
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 获取所有工具定义
   */
  getAllTools(): UnifiedToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取 Provider 格式的工具定义
   */
  getProviderToolDefinitions(): ReturnType<typeof toProviderToolDefinitions> {
    return toProviderToolDefinitions(this.getAllTools());
  }

  /**
   * 按来源过滤工具
   */
  getToolsBySource(source: UnifiedToolDefinition["source"]): UnifiedToolDefinition[] {
    return this.getAllTools().filter((tool) => tool.source === source);
  }

  /**
   * 获取工具数量
   */
  getToolCount(): number {
    return this.tools.size;
  }

  // ============================================================================
  // 工具执行
  // ============================================================================

  /**
   * 执行工具调用
   */
  async executeToolCall(toolCall: ToolCall): Promise<ToolCallResult> {
    const toolName = toolCall.function.name;
    const tool = this.tools.get(toolName);

    if (!tool) {
      const result: ToolCallResult = {
        toolCallId: toolCall.id,
        name: toolName,
        content: `Error: Tool "${toolName}" not found`,
        success: false,
      };
      this.emit("tool_call_end", result);
      return result;
    }

    this.emit("tool_call_start", toolCall);

    try {
      // 解析参数
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      // 执行工具
      const content = await this.executeWithTimeout(tool, args);

      const result: ToolCallResult = {
        toolCallId: toolCall.id,
        name: toolName,
        content,
        success: true,
      };

      this.emit("tool_call_end", result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const result: ToolCallResult = {
        toolCallId: toolCall.id,
        name: toolName,
        content: `Error: ${err.message}`,
        success: false,
      };

      this.emit("tool_call_end", result);
      this.emit("error", err);
      return result;
    }
  }

  /**
   * 带超时的工具执行
   */
  private async executeWithTimeout(
    tool: UnifiedToolDefinition,
    args: Record<string, unknown>
  ): Promise<string> {
    if (!tool.handler) {
      throw new Error(`Tool "${tool.name}" has no handler`);
    }

    return new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Tool execution timeout after ${this.config.executionTimeout}ms`));
      }, this.config.executionTimeout);

      tool.handler!(args)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 批量执行工具调用（并行）
   */
  async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolCallResult[]> {
    // 限制并行数量
    const batches: ToolCall[][] = [];
    for (let i = 0; i < toolCalls.length; i += this.config.maxParallelCalls) {
      batches.push(toolCalls.slice(i, i + this.config.maxParallelCalls));
    }

    const results: ToolCallResult[] = [];
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map((call) => this.executeToolCall(call))
      );
      results.push(...batchResults);
    }

    return results;
  }

  // ============================================================================
  // 工具编排
  // ============================================================================

  /**
   * 执行工具调用计划
   */
  async executePlan(plan: ToolCallPlan): Promise<ToolOrchestrationResult> {
    const results: ToolCallResult[] = [];

    if (plan.parallel) {
      // 并行执行
      const batchResults = await this.executeToolCalls(plan.calls);
      results.push(...batchResults);
    } else {
      // 串行执行
      for (const call of plan.calls) {
        const result = await this.executeToolCall(call);
        results.push(result);
      }
    }

    const success = results.every((r) => r.success);

    const result: ToolOrchestrationResult = {
      planId: plan.id,
      results,
      success,
    };

    if (!success) {
      result.error = "Some tool calls failed";
    }

    return result;
  }

  // ============================================================================
  // 动态工具管理
  // ============================================================================

  /**
   * 设置 Capabilities 注册表
   */
  setCapabilitiesRegistry(registry: CapabilitiesRegistryLike): void {
    this.config.capabilitiesRegistry = registry;
    if (this.initialized && this.config.enableCapabilities) {
      this.registerCapabilitiesTools();
    }
  }

  /**
   * 添加 MCP 客户端
   */
  async addMCPClient(name: string, client: MCPClientLike): Promise<void> {
    if (!this.config.mcpClients) {
      this.config.mcpClients = new Map();
    }
    this.config.mcpClients.set(name, client);

    if (this.initialized && this.config.enableMCP) {
      // 注册该客户端的工具
      try {
        const mcpTools = await client.listTools();
        const unifiedTools = convertMCPTools(mcpTools);

        for (const tool of unifiedTools) {
          tool.handler = async (args: Record<string, unknown>) => {
            const result = await client.callTool(tool.name, args);
            return typeof result.content === "string"
              ? result.content
              : JSON.stringify(result.content, null, 2);
          };
          this.registerTool(tool);
        }
      } catch (error) {
        if (this.config.debug) {
          console.error(`[ToolBridge] Failed to register MCP tools from ${name}:`, error);
        }
      }
    }
  }

  /**
   * 刷新所有工具
   */
  async refresh(): Promise<void> {
    this.tools.clear();
    this.initialized = false;
    await this.initialize();
  }

  // ============================================================================
  // 工具定义
  // ============================================================================

  /**
   * 清除所有工具
   */
  clear(): void {
    this.tools.clear();
    this.initialized = false;
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建工具桥接层
 */
export function createToolBridge(config?: ToolBridgeConfig): ToolBridge {
  return new ToolBridge(config);
}
