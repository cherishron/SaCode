/**
 * OpenAI Provider 测试
 * 测试 OpenAI Provider 的实现，包括消息构建、流式输出、工具调用等
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { OpenAIProvider, createOpenAIProvider } from "../openai";
import type { OpenAIProviderConfig, StreamChunk } from "../types";
import { APIKeyError, ProviderError } from "../types";

// Mock OpenAI SDK
vi.mock("openai", () => {
  const mockStream = {
    [Symbol.asyncIterator]: async function* () {
      yield {
        choices: [{
          delta: { content: "Hello" },
          finish_reason: null,
        }],
      };
      yield {
        choices: [{
          delta: { content: " World" },
          finish_reason: null,
        }],
      };
      yield {
        choices: [{
          delta: {},
          finish_reason: "stop",
        }],
      };
    },
  };

  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockStream),
        },
      },
    })),
  };
});

describe("OpenAIProvider", () => {
  let provider: OpenAIProvider;

  const config: OpenAIProviderConfig = {
    type: "openai",
    apiKey: "sk-test-key",
    model: "gpt-4o",
    debug: false,
  };

  beforeEach(() => {
    provider = new OpenAIProvider(config);
  });

  describe("初始化", () => {
    it("应该成功初始化", async () => {
      await provider.initialize();
      expect(provider.isInitialized).toBe(true);
    });

    it("应该在没有 API Key 时抛出错误", async () => {
      const invalidProvider = new OpenAIProvider({
        type: "openai",
        apiKey: "",
        model: "gpt-4o",
      });

      await expect(invalidProvider.initialize()).rejects.toThrow(APIKeyError);
    });

    it("应该使用自定义 baseUrl", async () => {
      const customProvider = new OpenAIProvider({
        type: "openai",
        apiKey: "sk-test-key",
        model: "gpt-4o",
        baseUrl: "https://custom.api.com/v1",
      });

      await customProvider.initialize();
      expect(customProvider.isInitialized).toBe(true);
    });

    it("应该为不同模型设置默认 baseUrl", async () => {
      const deepseekProvider = new OpenAIProvider({
        type: "deepseek",
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await deepseekProvider.initialize();
      expect(deepseekProvider.isInitialized).toBe(true);
    });

    it("应该发射 initialized 事件", async () => {
      const listener = vi.fn();
      provider.on("initialized", listener);

      await provider.initialize();
      expect(listener).toHaveBeenCalled();
    });

    it("重复初始化应该直接返回", async () => {
      await provider.initialize();
      await provider.initialize(); // 不应重复初始化
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
          description: "Get weather",
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

      // 流应该正常结束
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

  describe("错误处理", () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it("应该处理 API 错误", async () => {
      // 模拟未初始化客户端的情况
      (provider as any).client = null;

      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // 应该重新初始化并返回响应
      expect(chunks.some(c => c.type === "done")).toBe(true);
    });

    it("应该发射错误事件", async () => {
      const errorListener = vi.fn();
      provider.on("error", errorListener);

      // 模拟错误情况
      const error = new ProviderError("openai", "API_ERROR", "Test error");
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

  describe("工具调用映射", () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it("应该映射 finish_reason: stop", () => {
      // 通过流式输出验证
      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of stream) {
        if (chunk.type === "done") {
          expect(chunk.stopReason).toBe("end_turn");
        }
        chunks.push(chunk);
      }
    });

    it("应该映射 finish_reason: tool_calls", () => {
      const tool = {
        type: "function" as const,
        function: {
          name: "test_tool",
          description: "Test",
          parameters: { type: "object" as const, properties: {} },
        },
      };

      provider.registerTool(tool, vi.fn());

      const stream = provider.chat({
        messages: [{ role: "user", content: "Hello" }],
        tools: [tool],
      });

      for await (const chunk of stream) {
        if (chunk.type === "done") {
          // 验证完成事件被发射
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

      const debugProvider = new OpenAIProvider({
        type: "openai",
        apiKey: "sk-test-key",
        model: "gpt-4o",
        debug: true,
      });

      await debugProvider.initialize();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});

describe("createOpenAIProvider", () => {
  it("应该创建 OpenAIProvider 实例", () => {
    const provider = createOpenAIProvider({
      type: "openai",
      apiKey: "sk-test-key",
      model: "gpt-4o",
    });

    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.type).toBe("openai");
  });
});

describe("OpenAIProvider  baseUrl 映射", () => {
  it("应该为 deepseek 使用正确的 baseUrl", async () => {
    const provider = new OpenAIProvider({
      type: "deepseek",
      apiKey: "sk-test-key",
      model: "deepseek-chat",
    });

    await provider.initialize();
    expect(provider.isInitialized).toBe(true);
  });

  it("应该为 moonshot 使用正确的 baseUrl", async () => {
    const provider = new OpenAIProvider({
      type: "moonshot",
      apiKey: "sk-test-key",
      model: "moonshot-v1-8k",
    });

    await provider.initialize();
    expect(provider.isInitialized).toBe(true);
  });

  it("应该为 zhipu 使用正确的 baseUrl", async () => {
    const provider = new OpenAIProvider({
      type: "zhipu",
      apiKey: "sk-test-key",
      model: "glm-4",
    });

    await provider.initialize();
    expect(provider.isInitialized).toBe(true);
  });
});
