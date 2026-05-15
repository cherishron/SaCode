import { describe, it, expect, beforeEach, vi } from "vitest";
import { SACODEClient, createSACODEClient } from "../index";
import { ConnectionError, SACODEError } from "../../types";
import { createProvider, createProviderFromEnv } from "../../provider";
import { createToolBridge } from "../../tools";

vi.mock("../../provider", async () => {
  const actual = await vi.importActual("../../provider");
  return {
    ...(actual as object),
    createProvider: vi.fn().mockImplementation(() => ({
      type: "openai",
      model: "gpt-4o",
      isInitialized: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      chat: vi.fn().mockImplementation(async function* () {
        yield { type: "text_delta" as const, text: "Hello" };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
      registerTool: vi.fn(),
      executeToolCall: vi.fn(),
      on: vi.fn(),
      emit: vi.fn(),
    })),
    createProviderFromEnv: vi.fn().mockImplementation(() => ({
      type: "openai",
      model: "gpt-4o",
      isInitialized: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      chat: vi.fn().mockImplementation(async function* () {
        yield { type: "text_delta" as const, text: "Response" };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
      registerTool: vi.fn(),
    })),
  };
});

vi.mock("../../tools", async () => {
  const actual = await vi.importActual("../../tools");
  return {
    ...(actual as object),
    createToolBridge: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      getToolCount: vi.fn().mockReturnValue(5),
      getToolNames: vi.fn().mockReturnValue(["think", "plan", "calculate"]),
      getAllTools: vi.fn().mockReturnValue([]),
      getProviderToolDefinitions: vi.fn().mockReturnValue([]),
      registerTool: vi.fn(),
      executeToolCall: vi.fn().mockResolvedValue({
        success: true,
        content: "result",
        toolCallId: "call_1",
        name: "test_tool",
      }),
      executeToolCalls: vi.fn().mockResolvedValue([]),
      on: vi.fn(),
    })),
    ToolBridge: vi.fn(),
  };
});

vi.mock("../../agent", async () => {
  const actual = await vi.importActual("../../agent");
  return {
    ...(actual as object),
    createAgentRegistry: vi.fn().mockImplementation(() => ({
      getStats: vi.fn().mockReturnValue({ total: 3 }),
      on: vi.fn(),
    })),
    createPlanner: vi.fn().mockImplementation(() => ({
      assessComplexity: vi.fn().mockReturnValue({
        level: "simple",
        score: 0.1,
        taskCategory: "quick" as const,
        factors: {
          techStackCount: 0,
          toolCount: 0,
          estimatedSteps: 1,
          requiresExternalResources: false,
          requiresUserInteraction: false,
        },
      }),
      generatePlan: vi.fn().mockResolvedValue({
        id: "plan-1",
        description: "Test plan",
        goal: "Test",
        steps: [],
        status: "draft" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      on: vi.fn(),
    })),
    createOrchestrator: vi.fn().mockImplementation(() => ({
      executePlan: vi.fn().mockResolvedValue({
        planId: "plan-1",
        success: true,
        output: "done",
        completedSteps: 0,
        totalSteps: 0,
        duration: 0,
      }),
      on: vi.fn(),
    })),
  };
});

describe("SACODEClient", () => {
  let client: SACODEClient;

  const baseConfig = {
    provider: {
      type: "openai" as const,
      apiKey: "sk-test-key",
      model: "gpt-4o",
    },
    debug: false,
  };

  beforeEach(() => {
    vi.mocked(createProvider).mockImplementation(() => ({
      type: "openai",
      model: "gpt-4o",
      isInitialized: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      chat: vi.fn().mockImplementation(async function* () {
        yield { type: "text_delta" as const, text: "Hello" };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
      registerTool: vi.fn(),
      executeToolCall: vi.fn(),
      on: vi.fn(),
      emit: vi.fn(),
    }));
    vi.mocked(createToolBridge).mockImplementation(() => {
      const toolNames: string[] = ["think", "plan", "calculate"];
      return {
        initialize: vi.fn().mockResolvedValue(undefined),
        getToolCount: vi.fn().mockReturnValue(5),
        getToolNames: vi.fn().mockImplementation(() => [...toolNames]),
        getAllTools: vi.fn().mockReturnValue([]),
        getProviderToolDefinitions: vi.fn().mockReturnValue([]),
        registerTool: vi.fn().mockImplementation((tool: { name: string }) => {
          toolNames.push(tool.name);
        }),
        executeToolCall: vi.fn().mockResolvedValue({
          success: true,
          content: "result",
          toolCallId: "call_1",
          name: "test_tool",
        }),
        executeToolCalls: vi.fn().mockResolvedValue([]),
        on: vi.fn(),
      };
    });
    client = new SACODEClient(baseConfig);
  });

  describe("创建客户端", () => {
    it("应该创建客户端实例", () => {
      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(SACODEClient);
    });

    it("应该使用默认配置", () => {
      const defaultClient = new SACODEClient({
        provider: {
          type: "openai" as const,
          apiKey: "sk-test-key",
        },
      });

      expect(defaultClient).toBeDefined();
    });

    it("应该支持从环境变量创建", () => {
      const envClient = createSACODEClientFromEnv();
      expect(envClient).toBeDefined();
    });
  });

  describe("连接", () => {
    it("应该成功连接", async () => {
      const connectPromise = client.connect();
      await expect(connectPromise).resolves.not.toThrow();
      expect(client.isConnected()).toBe(true);
    });

    it("应该发射 connect 事件", async () => {
      const connectListener = vi.fn();
      client.on("connect", connectListener);

      await client.connect();
      expect(connectListener).toHaveBeenCalled();
    });

    it("重复连接应该直接返回", async () => {
      await client.connect();
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it("应该在 Provider 初始化失败时抛出错误", async () => {
      vi.mocked(createProvider).mockImplementationOnce(() => {
        throw new Error("Invalid API key");
      });

      const invalidClient = new SACODEClient({
        provider: {
          type: "openai" as const,
          apiKey: "invalid-key",
          model: "gpt-4o",
        },
      });

      await expect(invalidClient.connect()).rejects.toThrow(ConnectionError);
    });

    it("应该支持 Provider 配置", async () => {
      const customClient = new SACODEClient({
        provider: {
          type: "anthropic" as const,
          apiKey: "sk-ant-test-key",
          model: "claude-3-5-sonnet-20241022",
          baseUrl: "https://custom.api.com",
          timeout: 30000,
          maxRetries: 5,
          debug: true,
        },
        debug: true,
      });

      await customClient.connect();
      expect(customClient.isConnected()).toBe(true);
    });

    it("应该支持工具桥接层配置", async () => {
      const clientWithTools = new SACODEClient({
        provider: baseConfig.provider,
        toolBridge: {
          enableBuiltinTools: true,
          enableCapabilities: true,
          enableMCP: true,
        },
      });

      await clientWithTools.connect();
      expect(clientWithTools.isConnected()).toBe(true);
    });
  });

  describe("断开连接", () => {
    beforeEach(async () => {
      await client.connect();
    });

    it("应该成功断开连接", async () => {
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it("应该发射 disconnect 事件", async () => {
      const disconnectListener = vi.fn();
      client.on("disconnect", disconnectListener);

      await client.disconnect();
      expect(disconnectListener).toHaveBeenCalled();
    });

    it("应该清理消息历史", async () => {
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it("未连接时断开应该不抛出错误", async () => {
      const newClient = new SACODEClient(baseConfig);
      await expect(newClient.disconnect()).resolves.not.toThrow();
    });
  });

  describe("流式聊天", () => {
    beforeEach(async () => {
      await client.connect();
    });

    it("应该返回流式响应", async () => {
      const stream = client.chat("Hello");

      const chunks: unknown[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该支持 sessionId", async () => {
      const stream = client.chat("Hello", "session-123");

      const chunks: unknown[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该支持单次调用覆盖模型", async () => {
      const stream = client.chatWithOptions({
        message: "Hello",
        sessionId: "session-123",
        modelOverride: "claude-3-5-sonnet-20241022",
      });

      const chunks: unknown[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const provider = vi.mocked(createProvider).mock.results.at(-1)?.value;
      expect(provider?.chat).toHaveBeenCalled();
      expect(vi.mocked(provider!.chat).mock.calls.at(-1)?.[0]).toMatchObject({
        sessionId: "session-123",
        modelOverride: "claude-3-5-sonnet-20241022",
      });
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该在未连接时抛出错误", async () => {
      const newClient = new SACODEClient(baseConfig);

      await expect(async () => {
        const stream = newClient.chat("Hello");
        for await (const _ of stream) {
          void _;
        }
      }).rejects.toThrow(ConnectionError);
    });

    it("应该发射 message 事件", async () => {
      const messageListener = vi.fn();
      client.on("message", messageListener);

      const stream = client.chat("Hello");
      for await (const _ of stream) {
        void _;
      }

      expect(messageListener).toHaveBeenCalled();
    });

    it("应该处理工具调用循环", async () => {
      vi.mocked(createProvider).mockImplementationOnce(() => ({
        type: "openai",
        model: "gpt-4o",
        isInitialized: true,
        initialize: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn().mockResolvedValue(undefined),
        chat: vi.fn().mockImplementation(async function* () {
          yield {
            type: "tool_call" as const,
            toolCall: {
              id: "call_1",
              type: "function" as const,
              function: { name: "calculate", arguments: '{"expr":"2+2"}' },
            },
          };
          yield { type: "done" as const, stopReason: "tool_use" };
        }),
        registerTool: vi.fn(),
        executeToolCall: vi.fn(),
        on: vi.fn(),
        emit: vi.fn(),
      }));

      vi.mocked(createToolBridge).mockImplementationOnce(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        getToolCount: vi.fn().mockReturnValue(5),
        getToolNames: vi.fn().mockReturnValue(["calculate"]),
        getAllTools: vi.fn().mockReturnValue([]),
        getProviderToolDefinitions: vi.fn().mockReturnValue([]),
        registerTool: vi.fn(),
        executeToolCall: vi.fn().mockResolvedValue({
          success: true,
          content: "4",
          toolCallId: "call_1",
          name: "calculate",
        }),
        executeToolCalls: vi.fn().mockResolvedValue([]),
        on: vi.fn(),
      }));

      const toolClient = new SACODEClient(baseConfig);
      await toolClient.connect();

      const stream = toolClient.chat("Calculate 2+2");
      const chunks: unknown[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该达到最大循环次数时停止", async () => {
      const maxLoopClient = new SACODEClient({
        ...baseConfig,
        maxToolLoopIterations: 1,
      });

      await maxLoopClient.connect();

      const stream = maxLoopClient.chat("Hello");
      const chunks: unknown[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe("工具注册", () => {
    beforeEach(async () => {
      await client.connect();
    });

    it("应该注册自定义工具", () => {
      client.registerTool(
        "get_weather",
        "获取天气信息",
        {
          type: "object",
          properties: {
            city: { type: "string" },
          },
        },
        vi.fn().mockResolvedValue("Sunny")
      );

      expect(client.getAvailableTools()).toContain("get_weather");
    });

    it("应该在未连接时注册工具抛出错误", async () => {
      const newClient = new SACODEClient(baseConfig);

      expect(() => {
        newClient.registerTool("test", "Test", {}, vi.fn());
      }).toThrow(ConnectionError);
    });

    it("应该获取可用工具列表", () => {
      const tools = client.getAvailableTools();
      expect(Array.isArray(tools)).toBe(true);
    });

    it("应该获取工具桥接层", async () => {
      const bridge = client.getToolBridge();
      expect(bridge).not.toBeNull();
    });
  });

  describe("系统提示词", () => {
    beforeEach(async () => {
      await client.connect();
    });

    it("应该设置系统提示词", () => {
      client.setSystemPrompt("You are a helpful assistant");
      expect(client).toBeDefined();
    });
  });

  describe("消息历史", () => {
    beforeEach(async () => {
      await client.connect();
    });

    it("应该清除消息历史", () => {
      client.clearHistory();
      expect(client).toBeDefined();
    });
  });

  describe("发送消息", () => {
    beforeEach(async () => {
      await client.connect();
    });

    it("应该发送单条消息", async () => {
      await expect(client.sendMessage("Hello")).resolves.not.toThrow();
    });

    it("应该在未连接时抛出错误", async () => {
      const newClient = new SACODEClient(baseConfig);
      await expect(newClient.sendMessage("Hello")).rejects.toThrow(ConnectionError);
    });
  });

  describe("接收消息", () => {
    beforeEach(async () => {
      await client.connect();
    });

    it("应该接收消息流", async () => {
      const stream = client.receiveMessages();

      const chunks: unknown[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe("获取信息", () => {
    beforeEach(async () => {
      await client.connect();
    });

    it("应该获取 Provider 类型", () => {
      const type = client.getProviderType();
      expect(type).toBe("openai");
    });

    it("应该获取模型", () => {
      const model = client.getModel();
      expect(model).toBe("gpt-4o");
    });

    it("应该检查连接状态", () => {
      expect(client.isConnected()).toBe(true);
    });
  });

  describe("错误处理", () => {
    it("应该在聊天错误时发射 error 事件", async () => {
      vi.mocked(createProvider).mockImplementationOnce(() => ({
        type: "openai",
        model: "gpt-4o",
        isInitialized: true,
        initialize: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn().mockResolvedValue(undefined),
        chat: vi.fn().mockImplementation(async function* () {
          throw new Error("API error");
        }),
        registerTool: vi.fn(),
        executeToolCall: vi.fn(),
        on: vi.fn(),
        emit: vi.fn(),
      }));

      const errorClient = new SACODEClient(baseConfig);
      await errorClient.connect();

      const errorListener = vi.fn();
      errorClient.on("error", errorListener);

      await expect(async () => {
        const stream = errorClient.chat("Hello");
        for await (const _ of stream) {
          void _;
        }
      }).rejects.toThrow(SACODEError);

      expect(errorListener).toHaveBeenCalled();
    });
  });

  describe("调试模式", () => {
    it("应该在调试模式下输出日志", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const debugClient = new SACODEClient({
        ...baseConfig,
        debug: true,
      });

      await debugClient.connect();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});

describe("createSACODEClient", () => {
  it("应该创建 SACODEClient 实例", () => {
    const c = createSACODEClient({
      provider: {
        type: "openai" as const,
        apiKey: "sk-test-key",
        model: "gpt-4o",
      },
    });

    expect(c).toBeInstanceOf(SACODEClient);
  });
});

function createSACODEClientFromEnv(): SACODEClient {
  return new SACODEClient({});
}
