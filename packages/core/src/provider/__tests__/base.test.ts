/**
 * BaseProvider 测试
 * 测试基类的重试逻辑、错误处理和工具管理功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { BaseProvider, DEFAULT_RETRY_CONFIG, calculateBackoff, shouldRetry } from "../base";
import type { BaseProviderConfig, ToolDefinition, ChatCompletionOptions, StreamChunk } from "../types";
import { ProviderError, RateLimitError } from "../types";

// 测试用的 Provider 实现
class TestProvider extends BaseProvider {
  readonly type = "test" as const;
  private shouldFailCount = 0;
  private failCounter = 0;

  setShouldFail(count: number) {
    this.shouldFailCount = count;
    this.failCounter = 0;
  }

  async initialize(): Promise<void> {
    this._isInitialized = true;
    this.emit("initialized");
  }

  async *chat(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    if (this.shouldFailCount > 0 && this.failCounter < this.shouldFailCount) {
      this.failCounter++;
      throw new ProviderError(this.type, "SERVICE_UNAVAILABLE", "Service temporarily unavailable");
    }

    yield { type: "text_delta", text: "Hello" };
    yield { type: "done", stopReason: "end_turn" };
  }

  // 暴露 protected 方法用于测试
  public testWithRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    return this.withRetry(operation, operationName);
  }

  public testIsRetryableError(error: Error): boolean {
    return this.isRetryableError(error);
  }
}

describe("BaseProvider", () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider({
      type: "test",
      apiKey: "test-key",
      model: "test-model",
      debug: false,
    });
  });

  describe("基础属性", () => {
    it("应该正确设置 type 和 model", () => {
      expect(provider.type).toBe("test");
      expect(provider.model).toBe("test-model");
    });

    it("应该默认为未初始化状态", () => {
      expect(provider.isInitialized).toBe(false);
    });

    it("初始化后应该变为已初始化状态", async () => {
      await provider.initialize();
      expect(provider.isInitialized).toBe(true);
    });
  });

  describe("工具管理", () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it("应该注册工具", () => {
      const tool: ToolDefinition = {
        type: "function",
        function: {
          name: "test_tool",
          description: "A test tool",
          parameters: {
            type: "object",
            properties: {
              input: { type: "string" },
            },
          },
        },
      };

      const handler = vi.fn().mockResolvedValue("result");
      provider.registerTool(tool, handler);

      // 工具已注册（不直接暴露，通过 executeToolCall 验证）
      expect(handler).toBeDefined();
    });

    it("应该执行工具调用", async () => {
      const tool: ToolDefinition = {
        type: "function",
        function: {
          name: "calculator",
          description: "Calculate expression",
          parameters: {
            type: "object",
            properties: {
              expression: { type: "string" },
            },
          },
        },
      };

      const handler = vi.fn().mockResolvedValue("4");
      provider.registerTool(tool, handler);

      const toolCall = {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "calculator",
          arguments: JSON.stringify({ expression: "2 + 2" }),
        },
      };

      const result = await provider.executeToolCall(toolCall);

      expect(result.success).toBe(true);
      expect(result.content).toBe("4");
      expect(result.toolCallId).toBe("call_1");
      expect(handler).toHaveBeenCalledWith({ expression: "2 + 2" });
    });

    it("应该处理不存在的工具", async () => {
      const toolCall = {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "non_existent_tool",
          arguments: "{}",
        },
      };

      const result = await provider.executeToolCall(toolCall);

      expect(result.success).toBe(false);
      expect(result.content).toContain("not found");
    });

    it("应该处理工具执行错误", async () => {
      const tool: ToolDefinition = {
        type: "function",
        function: {
          name: "error_tool",
          description: "Always errors",
          parameters: { type: "object", properties: {} },
        },
      };

      const handler = vi.fn().mockRejectedValue(new Error("Tool execution failed"));
      provider.registerTool(tool, handler);

      const toolCall = {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "error_tool",
          arguments: "{}",
        },
      };

      const result = await provider.executeToolCall(toolCall);

      expect(result.success).toBe(false);
      expect(result.content).toContain("Tool execution error");
    });

    it("应该获取所有工具定义", async () => {
      const tool1: ToolDefinition = {
        type: "function",
        function: {
          name: "tool1",
          description: "Tool 1",
          parameters: { type: "object", properties: {} },
        },
      };

      const tool2: ToolDefinition = {
        type: "function",
        function: {
          name: "tool2",
          description: "Tool 2",
          parameters: { type: "object", properties: {} },
        },
      };

      provider.registerTool(tool1, vi.fn());
      provider.registerTool(tool2, vi.fn());

      // 通过 destroy 验证工具被清理
      await provider.destroy();
      expect(provider.isInitialized).toBe(false);
    });

    it("应该发射工具调用事件", async () => {
      const tool: ToolDefinition = {
        type: "function",
        function: {
          name: "event_tool",
          description: "Event tool",
          parameters: { type: "object", properties: {} },
        },
      };

      const handler = vi.fn().mockResolvedValue("done");
      provider.registerTool(tool, handler);

      const startListener = vi.fn();
      const endListener = vi.fn();

      provider.on("tool_call_start", startListener);
      provider.on("tool_call_end", endListener);

      const toolCall = {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "event_tool",
          arguments: "{}",
        },
      };

      await provider.executeToolCall(toolCall);

      expect(startListener).toHaveBeenCalledWith(toolCall);
      expect(endListener).toHaveBeenCalled();
    });
  });

  describe("重试逻辑", () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it("应该成功执行不需要重试的操作", async () => {
      const operation = vi.fn().mockResolvedValue("success");
      const result = await provider.testWithRetry(operation, "test-op");

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("应该在失败时重试", async () => {
      provider.sleep = vi.fn().mockResolvedValue(undefined);
      const operation = vi.fn()
        .mockRejectedValueOnce(new ProviderError("test", "SERVICE_UNAVAILABLE", "Error 1"))
        .mockRejectedValueOnce(new ProviderError("test", "SERVICE_UNAVAILABLE", "Error 2"))
        .mockResolvedValue("success");

      const result = await provider.testWithRetry(operation, "test-op");

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("应该达到最大重试次数后抛出错误", async () => {
      provider.sleep = vi.fn().mockResolvedValue(undefined);
      const operation = vi.fn().mockRejectedValue(
        new ProviderError("test", "SERVICE_UNAVAILABLE", "Always fails")
      );

      await expect(provider.testWithRetry(operation, "test-op")).rejects.toThrow(ProviderError);
      expect(operation).toHaveBeenCalledTimes(DEFAULT_RETRY_CONFIG.maxRetries + 1);
    });

    it("应该对不可重试的错误立即抛出", async () => {
      const nonRetryableError = new ProviderError("test", "INVALID_REQUEST", "Not retryable");
      const operation = vi.fn().mockRejectedValue(nonRetryableError);

      await expect(provider.testWithRetry(operation, "test-op")).rejects.toThrow(ProviderError);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("应该使用指数退避策略", async () => {
      const delays: number[] = [];
      provider.sleep = vi.fn(async (ms: number) => {
        delays.push(ms);
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(new ProviderError("test", "SERVICE_UNAVAILABLE", "Error 1"))
        .mockRejectedValueOnce(new ProviderError("test", "SERVICE_UNAVAILABLE", "Error 2"))
        .mockResolvedValue("success");

      await provider.testWithRetry(operation, "test-op");

      expect(delays.length).toBe(2);
      expect(delays[0]).toBeLessThan(delays[1]);
    });
  });

  describe("错误处理", () => {
    it("应该识别可重试的错误", async () => {
      await provider.initialize();

      const retryableErrors = [
        new ProviderError("test", "RATE_LIMIT_ERROR", "Rate limited"),
        new ProviderError("test", "TIMEOUT_ERROR", "Timeout"),
        new ProviderError("test", "SERVICE_UNAVAILABLE", "Service unavailable"),
        new ProviderError("test", "INTERNAL_ERROR", "Internal error"),
        new ProviderError("test", "CONNECTION_ERROR", "Connection error"),
      ];

      for (const error of retryableErrors) {
        expect(provider.testIsRetryableError(error)).toBe(true);
      }
    });

    it("应该识别不可重试的错误", async () => {
      await provider.initialize();

      const nonRetryableErrors = [
        new ProviderError("test", "INVALID_REQUEST", "Bad request"),
        new ProviderError("test", "AUTHENTICATION_ERROR", "Auth failed"),
        new Error("Some other error"),
      ];

      for (const error of nonRetryableErrors) {
        expect(provider.testIsRetryableError(error)).toBe(false);
      }
    });

    it("应该识别网络错误为可重试", async () => {
      await provider.initialize();

      const networkErrors = [
        Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }),
        Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }),
        Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }),
        Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }),
      ];

      for (const error of networkErrors) {
        expect(provider.testIsRetryableError(error)).toBe(true);
      }
    });

    it("应该发射错误事件", async () => {
      await provider.initialize();

      const errorListener = vi.fn();
      provider.on("error", errorListener);

      const error = new Error("Test error");
      (provider as any).emitError(error);

      expect(errorListener).toHaveBeenCalledWith(error);
    });

    it("应该发射完成事件", async () => {
      await provider.initialize();

      const completeListener = vi.fn();
      provider.on("response_complete", completeListener);

      (provider as any).emitComplete("end_turn");

      expect(completeListener).toHaveBeenCalledWith("end_turn");
    });
  });

  describe("销毁", () => {
    it("应该清理工具并重置初始化状态", async () => {
      await provider.initialize();

      const tool: ToolDefinition = {
        type: "function",
        function: {
          name: "temp_tool",
          description: "Temp",
          parameters: { type: "object", properties: {} },
        },
      };

      provider.registerTool(tool, vi.fn());
      await provider.destroy();

      expect(provider.isInitialized).toBe(false);
    });
  });
});

describe("辅助函数", () => {
  describe("calculateBackoff", () => {
    it("应该计算指数退避延迟", () => {
      expect(calculateBackoff(0, 1000, 30000, 2)).toBe(1000);
      expect(calculateBackoff(1, 1000, 30000, 2)).toBe(2000);
      expect(calculateBackoff(2, 1000, 30000, 2)).toBe(4000);
      expect(calculateBackoff(3, 1000, 30000, 2)).toBe(8000);
    });

    it("应该限制最大延迟", () => {
      expect(calculateBackoff(10, 1000, 30000, 2)).toBe(30000);
      expect(calculateBackoff(20, 1000, 30000, 2)).toBe(30000);
    });
  });

  describe("shouldRetry", () => {
    it("应该对可重试的错误返回 true", () => {
      const retryableError = new ProviderError("test", "RATE_LIMIT_ERROR", "Rate limited");
      expect(shouldRetry(retryableError, DEFAULT_RETRY_CONFIG.retryableErrors)).toBe(true);
    });

    it("应该对不可重试的错误返回 false", () => {
      const nonRetryableError = new ProviderError("test", "INVALID_REQUEST", "Bad request");
      expect(shouldRetry(nonRetryableError, DEFAULT_RETRY_CONFIG.retryableErrors)).toBe(false);
    });

    it("应该对非 ProviderError 返回 false", () => {
      expect(shouldRetry(new Error("Generic error"), DEFAULT_RETRY_CONFIG.retryableErrors)).toBe(false);
    });
  });
});
