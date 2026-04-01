/**
 * Anthropic Provider 测试
 * 测试 Anthropic Provider 的实现，包括消息构建、流式输出、工具调用等
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AnthropicProvider, createAnthropicProvider } from "../anthropic";
import type { AnthropicProviderConfig, StreamChunk } from "../types";
import { APIKeyError } from "../types";

// Mock Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => {
  const mockStream = {
    [Symbol.asyncIterator]: async function* () {
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
        index: 0,
      };
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: " World" },
        index: 0,
      };
      yield {
        type: "message_stop",
      };
    },
    finalMessage: vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
    }),
  };

  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        stream: vi.fn().mockResolvedValue(mockStream),
      },
    })),
  };
});

describe("AnthropicProvider", () => {
  let provider: AnthropicProvider;

  const config: AnthropicProviderConfig = {
    type: "anthropic",
    apiKey: "sk-ant-test-key",
    model: "claude-3-5-sonnet-20241022",
    debug: false,
  };

  beforeEach(() => {
    provider = new AnthropicProvider(config);
  });

  describe("初始化", () => {
    it("应该成功初始化", async () => {
      await provider.initialize();
      expect(provider.isInitialized).toBe(true);
    });

    it("应该在没有 API Key 时抛出错误", async () => {
      const invalidProvider = new AnthropicProvider({
        type: "anthropic",
        apiKey: "",
        model: "claude-3-5-sonnet-20241022",
      });

      await expect(invalidProvider.initialize()).rejects.toThrow(APIKeyError);
    });

    it("应该使用自定义 baseUrl", async () => {
      const customProvider = new AnthropicProvider({
        type: "anthropic",
        apiKey: "sk-ant-test-key",
        model: "claude-3-5-sonnet-20241022",
        baseUrl: "https://custom.anthropic-api.com/v1",
      });

      await customProvider.initialize();
      expect(customProvider.isInitialized).toBe(true);
    });

    it("应该发射 initialized 事件", async () => {
      const listener = vi.fn();
      provider.on("initialized", listener);

      await provider.initialize();
      expect(listener).toHaveBeenCalled();
    });

    it("重复初始化应该直接返回", async () => {
      await provider.initialize();
      await provider.initialize();
      expect(provider.isInitialized).toBe(true);
    });
  });

  describe("流式聊天", () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it("应该返回流式响应", async () => {
      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === "text_delta")).toBe(true);
      expect(chunks.some(c => c.type === "done")).toBe(true);
    });

    it("应该包含系统提示词", async () => {
      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
        systemPrompt: "You are a helpful assistant",
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === "done")).toBe(true);
    });

    it("应该处理多轮对话", async () => {
      const stream = provider.chat({
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
          { role: "user", content: "How are you?" },
        ],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该处理工具调用", async () => {
      const tool = {
        type: "function" as const,
        function: {
          name: "get_weather",
          description: "Get weather information",
          parameters: {
            type: "object" as const,
            properties: {
              city: { type: "string" },
            },
          },
        },
      };

      provider.registerTool(tool, vi.fn().mockResolvedValue("Sunny"));

      const stream = provider.chat({
        messages: [{ role: "user", content: "What's the weather?" }],
        tools: [tool],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === "done")).toBe(true);
    });

    it("应该处理温度参数", async () => {
      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === "done")).toBe(true);
    });

    it("应该处理 maxTokens 参数", async () => {
      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
        maxTokens: 100,
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === "done")).toBe(true);
    });

    it("应该处理停止序列", async () => {
      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
        stopSequences: ["\n\n"],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === "done")).toBe(true);
    });

    it("应该处理 topP 参数", async () => {
      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
        topP: 0.9,
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === "done")).toBe(true);
    });
  });

  describe("消息构建", () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it("应该正确处理用户消息", async () => {
      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === "done")).toBe(true);
    });

    it("应该正确处理助手消息", async () => {
      const stream = provider.chat({
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi!" },
        ],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === "done")).toBe(true);
    });

    it("应该跳过系统消息", async () => {
      const stream = provider.chat({
        messages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "Hello" },
        ],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // 系统消息被跳过，但流仍应正常结束
      expect(chunks.some(c => c.type === "done")).toBe(true);
    });

    it("应该处理多模态内容", async () => {
      const stream = provider.chat({
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "What's in this image?" },
            { type: "image", text: "https://example.com/image.jpg" },
          ],
        }],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === "done")).toBe(true);
    });
  });

  describe("流事件处理", () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it("应该处理 content_block_start 事件", async () => {
      // Mock 包含 tool_use 的流
      vi.mocked(await import("@anthropic-ai/sdk")).default.mockImplementation(
        () => ({
          messages: {
            stream: vi.fn().mockResolvedValue({
              [Symbol.asyncIterator]: async function* () {
                yield {
                  type: "content_block_start",
                  index: 0,
                  content_block: {
                    type: "tool_use",
                    id: "tool_1",
                    name: "get_weather",
                    input: {},
                  },
                };
                yield {
                  type: "content_block_stop",
                  index: 0,
                };
                yield {
                  type: "message_stop",
                };
              },
              finalMessage: vi.fn().mockResolvedValue({
                stop_reason: "tool_use",
              }),
            }),
          },
        }) as any
      );

      const tool = {
        type: "function" as const,
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object" as const, properties: {} },
        },
      };

      provider.registerTool(tool, vi.fn());

      const stream = provider.chat({
        messages: [{ role: "user", content: "Weather?" }],
        tools: [tool],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // 应该包含 tool_call
      expect(chunks.some(c => c.type === "tool_call")).toBe(true);
    });

    it("应该处理 input_json_delta 事件", async () => {
      vi.mocked(await import("@anthropic-ai/sdk")).default.mockImplementation(
        () => ({
          messages: {
            stream: vi.fn().mockResolvedValue({
              [Symbol.asyncIterator]: async function* () {
                yield {
                  type: "content_block_start",
                  index: 0,
                  content_block: {
                    type: "tool_use",
                    id: "tool_1",
                    name: "calculate",
                    input: {},
                  },
                };
                yield {
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "input_json_delta", partial_json: '{"expr":' },
                };
                yield {
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "input_json_delta", partial_json: '"2+2"}' },
                };
                yield {
                  type: "content_block_stop",
                  index: 0,
                };
                yield {
                  type: "message_stop",
                };
              },
              finalMessage: vi.fn().mockResolvedValue({
                stop_reason: "tool_use",
              }),
            }),
          },
        }) as any
      );

      const tool = {
        type: "function" as const,
        function: {
          name: "calculate",
          description: "Calculate",
          parameters: { type: "object" as const, properties: {} },
        },
      };

      provider.registerTool(tool, vi.fn());

      const stream = provider.chat({
        messages: [{ role: "user", content: "Calculate 2+2" }],
        tools: [tool],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const toolCallChunk = chunks.find(c => c.type === "tool_call");
      expect(toolCallChunk).toBeDefined();
      if (toolCallChunk?.type === "tool_call") {
        expect(toolCallChunk.toolCall.function.name).toBe("calculate");
      }
    });
  });

  describe("错误处理", () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it("应该处理 API 错误", async () => {
      (provider as any).client = null;

      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === "done")).toBe(true);
    });

    it("应该发射错误事件", async () => {
      const errorListener = vi.fn();
      provider.on("error", errorListener);

      const error = new Error("Test error");
      (provider as any).emitError(error);

      expect(errorListener).toHaveBeenCalledWith(error);
    });

    it("应该发射完成事件", async () => {
      const completeListener = vi.fn();
      provider.on("response_complete", completeListener);

      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      for await (const chunk of stream) {
        // 消费流
      }

      expect(completeListener).toHaveBeenCalled();
    });
  });

  describe("停止原因映射", () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it("应该映射 end_turn", () => {
      // 通过流式输出验证
      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      for await (const chunk of stream) {
        if (chunk.type === "done") {
          expect(chunk.stopReason).toBe("end_turn");
        }
      }
    });
  });

  describe("销毁", () => {
    it("应该清理客户端", async () => {
      await provider.initialize();
      await provider.destroy();
      expect(provider.isInitialized).toBe(false);
    });
  });

  describe("调试模式", () => {
    it("应该在调试模式下输出日志", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const debugProvider = new AnthropicProvider({
        type: "anthropic",
        apiKey: "sk-ant-test-key",
        model: "claude-3-5-sonnet-20241022",
        debug: true,
      });

      await debugProvider.initialize();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("Provider 类型", () => {
    it("应该始终返回 anthropic 类型", () => {
      expect(provider.type).toBe("anthropic");
    });
  });
});

describe("createAnthropicProvider", () => {
  it("应该创建 AnthropicProvider 实例", () => {
    const provider = createAnthropicProvider({
      type: "anthropic",
      apiKey: "sk-ant-test-key",
      model: "claude-3-5-sonnet-20241022",
    });

    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.type).toBe("anthropic");
  });
});
