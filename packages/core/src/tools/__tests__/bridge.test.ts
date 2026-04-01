/**
 * ToolBridge 工具桥接层测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ToolBridge,
  createToolBridge,
  toProviderToolDefinitions,
  convertCapabilitiesTools,
  convertMCPTools,
  getBuiltinToolNames,
  BUILTIN_TOOLS,
} from "../index";
import type {
  UnifiedToolDefinition,
  CapabilitiesToolDefinition,
  MCPToolDefinition,
  ToolCall,
} from "../types";

describe("ToolBridge", () => {
  let bridge: ToolBridge;

  beforeEach(() => {
    bridge = createToolBridge({ debug: false });
  });

  describe("初始化", () => {
    it("应该创建 ToolBridge 实例", () => {
      expect(bridge).toBeInstanceOf(ToolBridge);
      expect(bridge.isInitialized()).toBe(false);
    });

    it("应该初始化内置工具", async () => {
      await bridge.initialize();
      expect(bridge.isInitialized()).toBe(true);
      expect(bridge.getToolCount()).toBeGreaterThan(0);
    });

    it("应该能禁用内置工具", async () => {
      const customBridge = createToolBridge({ enableBuiltinTools: false });
      await customBridge.initialize();
      expect(customBridge.getToolCount()).toBe(0);
    });
  });

  describe("工具注册", () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    it("应该注册自定义工具", () => {
      const tool: UnifiedToolDefinition = {
        name: "test_tool",
        description: "A test tool",
        parameters: {
          type: "object",
          properties: {
            input: { type: "string" },
          },
        },
        source: "custom",
        handler: async (args) => `Result: ${args.input as string}`,
      };

      bridge.registerTool(tool);
      expect(bridge.hasTool("test_tool")).toBe(true);
      expect(bridge.getTool("test_tool")).toEqual(tool);
    });

    it("应该注销工具", () => {
      const toolName = getBuiltinToolNames()[0];
      expect(bridge.hasTool(toolName)).toBe(true);

      const result = bridge.unregisterTool(toolName);
      expect(result).toBe(true);
      expect(bridge.hasTool(toolName)).toBe(false);
    });

    it("应该覆盖已存在的工具", () => {
      const toolName = getBuiltinToolNames()[0];
      const originalTool = bridge.getTool(toolName);

      const newTool: UnifiedToolDefinition = {
        ...originalTool!,
        description: "Overridden description",
      };

      bridge.registerTool(newTool);
      expect(bridge.getTool(toolName)?.description).toBe("Overridden description");
    });
  });

  describe("工具查询", () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    it("应该返回所有工具名称", () => {
      const names = bridge.getToolNames();
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain("think");
      expect(names).toContain("plan");
    });

    it("应该返回所有工具定义", () => {
      const tools = bridge.getAllTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it("应该返回 Provider 格式的工具定义", () => {
      const providerTools = bridge.getProviderToolDefinitions();
      expect(providerTools.length).toBeGreaterThan(0);
      expect(providerTools[0]).toHaveProperty("type", "function");
      expect(providerTools[0]).toHaveProperty("function");
      expect(providerTools[0].function).toHaveProperty("name");
      expect(providerTools[0].function).toHaveProperty("description");
      expect(providerTools[0].function).toHaveProperty("parameters");
    });

    it("应该按来源过滤工具", () => {
      const builtinTools = bridge.getToolsBySource("builtin");
      expect(builtinTools.length).toBeGreaterThan(0);
      expect(builtinTools.every((t) => t.source === "builtin")).toBe(true);
    });
  });

  describe("工具执行", () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    it("应该执行工具调用", async () => {
      const toolCall: ToolCall = {
        id: "call_1",
        type: "function",
        function: {
          name: "get_current_time",
          arguments: "{}",
        },
      };

      const result = await bridge.executeToolCall(toolCall);
      expect(result.success).toBe(true);
      expect(result.content).toBeTruthy();
    });

    it("应该处理不存在的工具", async () => {
      const toolCall: ToolCall = {
        id: "call_1",
        type: "function",
        function: {
          name: "non_existent_tool",
          arguments: "{}",
        },
      };

      const result = await bridge.executeToolCall(toolCall);
      expect(result.success).toBe(false);
      expect(result.content).toContain("not found");
    });

    it("应该执行 calculate 工具", async () => {
      const toolCall: ToolCall = {
        id: "call_1",
        type: "function",
        function: {
          name: "calculate",
          arguments: JSON.stringify({ expression: "2 + 2" }),
        },
      };

      const result = await bridge.executeToolCall(toolCall);
      expect(result.success).toBe(true);
      expect(result.content).toContain("4");
    });

    it("应该执行 think 工具", async () => {
      const toolCall: ToolCall = {
        id: "call_1",
        type: "function",
        function: {
          name: "think",
          arguments: JSON.stringify({ thought: "Testing think tool" }),
        },
      };

      const result = await bridge.executeToolCall(toolCall);
      expect(result.success).toBe(true);
      expect(result.content).toContain("Testing think tool");
    });

    it("应该批量执行工具调用", async () => {
      const toolCalls: ToolCall[] = [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "get_current_time",
            arguments: "{}",
          },
        },
        {
          id: "call_2",
          type: "function",
          function: {
            name: "calculate",
            arguments: JSON.stringify({ expression: "10 / 2" }),
          },
        },
      ];

      const results = await bridge.executeToolCalls(toolCalls);
      expect(results.length).toBe(2);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });

  describe("事件发射", () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    it("应该在注册工具时发射 tool_registered 事件", () => {
      const listener = vi.fn();
      bridge.on("tool_registered", listener);

      const tool: UnifiedToolDefinition = {
        name: "event_test_tool",
        description: "Test event",
        parameters: { type: "object", properties: {} },
        source: "custom",
      };

      bridge.registerTool(tool);
      expect(listener).toHaveBeenCalledWith(tool);
    });

    it("应该在工具调用开始时发射 tool_call_start 事件", async () => {
      const listener = vi.fn();
      bridge.on("tool_call_start", listener);

      const toolCall: ToolCall = {
        id: "call_1",
        type: "function",
        function: {
          name: "get_current_time",
          arguments: "{}",
        },
      };

      await bridge.executeToolCall(toolCall);
      expect(listener).toHaveBeenCalledWith(toolCall);
    });

    it("应该在工具调用结束时发射 tool_call_end 事件", async () => {
      const listener = vi.fn();
      bridge.on("tool_call_end", listener);

      const toolCall: ToolCall = {
        id: "call_1",
        type: "function",
        function: {
          name: "get_current_time",
          arguments: "{}",
        },
      };

      await bridge.executeToolCall(toolCall);
      expect(listener).toHaveBeenCalled();
      const result = listener.mock.calls[0][0];
      expect(result.success).toBe(true);
    });
  });
});

describe("工具转换器", () => {
  describe("toProviderToolDefinitions", () => {
    it("应该转换工具定义为 Provider 格式", () => {
      const tools: UnifiedToolDefinition[] = [
        {
          name: "test_tool",
          description: "Test description",
          parameters: {
            type: "object",
            properties: {
              input: { type: "string" },
            },
          },
          source: "builtin",
        },
      ];

      const providerTools = toProviderToolDefinitions(tools);
      expect(providerTools.length).toBe(1);
      expect(providerTools[0].type).toBe("function");
      expect(providerTools[0].function.name).toBe("test_tool");
    });
  });

  describe("convertCapabilitiesTools", () => {
    it("应该转换 Capabilities 工具格式", () => {
      const capTools: CapabilitiesToolDefinition[] = [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: {
            _def: {
              typeName: "ZodObject",
              shape: () => ({
                path: { _def: { typeName: "ZodString" } },
              }),
            },
          },
          execute: async () => "file content",
        },
      ];

      const unifiedTools = convertCapabilitiesTools(capTools);
      expect(unifiedTools.length).toBe(1);
      expect(unifiedTools[0].name).toBe("read_file");
      expect(unifiedTools[0].source).toBe("capabilities");
      expect(unifiedTools[0].handler).toBeDefined();
    });
  });

  describe("convertMCPTools", () => {
    it("应该转换 MCP 工具格式", () => {
      const mcpTools: MCPToolDefinition[] = [
        {
          name: "mcp_tool",
          description: "MCP tool description",
          inputSchema: {
            type: "object",
            properties: {
              param: { type: "string" },
            },
          },
        },
      ];

      const unifiedTools = convertMCPTools(mcpTools);
      expect(unifiedTools.length).toBe(1);
      expect(unifiedTools[0].name).toBe("mcp_tool");
      expect(unifiedTools[0].source).toBe("mcp");
    });
  });
});

describe("内置工具", () => {
  it("应该包含必要的内置工具", () => {
    const names = getBuiltinToolNames();
    expect(names).toContain("think");
    expect(names).toContain("plan");
    expect(names).toContain("get_current_time");
    expect(names).toContain("calculate");
  });

  it("内置工具应该有正确的结构", () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("parameters");
      expect(tool).toHaveProperty("source", "builtin");
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
    }
  });
});
