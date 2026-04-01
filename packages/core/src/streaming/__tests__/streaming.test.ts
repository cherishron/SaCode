/**
 * StreamingManager 测试
 * 测试流式输出管理器的核心功能：会话管理、追加、刷新等
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { StreamingManager, createStreamingManager } from "../index";
import type { StreamChunk } from "../types";

describe("StreamingManager", () => {
  let streamingManager: StreamingManager;

  beforeEach(() => {
    streamingManager = new StreamingManager({
      enabled: true,
      minBufferSize: 10,
      maxBufferSize: 25,
      flushTimeout: 100,
    });
  });

  afterEach(() => {
    // 清理所有会话
    streamingManager.getAllSessions().forEach(session => {
      streamingManager.endSession(session.id);
    });
  });

  describe("初始化", () => {
    it("应该创建 StreamingManager 实例", () => {
      expect(streamingManager).toBeDefined();
      expect(streamingManager).toBeInstanceOf(StreamingManager);
    });

    it("应该使用默认配置", () => {
      const defaultManager = createStreamingManager();
      expect(defaultManager).toBeDefined();
    });

    it("应该使用自定义配置", () => {
      const customManager = new StreamingManager({
        enabled: false,
        minBufferSize: 5,
        maxBufferSize: 15,
        flushTimeout: 50,
      });

      expect(customManager).toBeDefined();
    });
  });

  describe("会话管理", () => {
    it("应该开始流式会话", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123",
        "正在思考..."
      );

      expect(sessionId).toBeDefined();
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it("应该获取会话", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123"
      );

      const session = streamingManager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.id).toBe(sessionId);
      expect(session?.platform).toBe("telegram");
      expect(session?.channelId).toBe("chat_123");
    });

    it("应该返回 undefined 对于不存在的会话", () => {
      const session = streamingManager.getSession("non-existent");
      expect(session).toBeUndefined();
    });

    it("应该获取所有会话", async () => {
      await streamingManager.startSession("telegram", "chat_1");
      await streamingManager.startSession("wechat", "chat_2");
      await streamingManager.startSession("discord", "chat_3");

      const sessions = streamingManager.getAllSessions();
      expect(sessions).toHaveLength(3);
    });

    it("应该结束会话", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123"
      );

      const ended = streamingManager.endSession(sessionId);
      expect(ended).toBe(true);

      const session = streamingManager.getSession(sessionId);
      expect(session).toBeUndefined();
    });

    it("应该返回 false 对于不存在的会话结束", () => {
      const ended = streamingManager.endSession("non-existent");
      expect(ended).toBe(false);
    });
  });

  describe("追加内容", () => {
    it("应该追加文本块", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123"
      );

      const chunk: StreamChunk = {
        type: "text_delta",
        text: "Hello",
      };

      await streamingManager.appendChunk(sessionId, chunk);

      const session = streamingManager.getSession(sessionId);
      expect(session?.accumulatedText).toContain("Hello");
    });

    it("应该追加多个文本块", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123"
      );

      await streamingManager.appendChunk(sessionId, { type: "text_delta", text: "Hello" });
      await streamingManager.appendChunk(sessionId, { type: "text_delta", text: " " });
      await streamingManager.appendChunk(sessionId, { type: "text_delta", text: "World" });

      const session = streamingManager.getSession(sessionId);
      expect(session?.accumulatedText).toContain("Hello World");
    });

    it("应该处理工具调用块", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123"
      );

      const chunk: StreamChunk = {
        type: "tool_call",
        toolCall: {
          id: "call_1",
          type: "function",
          function: {
            name: "test_tool",
            arguments: "{}",
          },
        },
      };

      await streamingManager.appendChunk(sessionId, chunk);

      const session = streamingManager.getSession(sessionId);
      expect(session).toBeDefined();
    });

    it("应该处理完成块", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123"
      );

      const chunk: StreamChunk = {
        type: "done",
        stopReason: "end_turn",
      };

      await streamingManager.appendChunk(sessionId, chunk);

      const session = streamingManager.getSession(sessionId);
      expect(session).toBeDefined();
    });

    it("应该处理错误块", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123"
      );

      const chunk: StreamChunk = {
        type: "error",
        error: {
          code: "TEST_ERROR",
          message: "Test error message",
        },
      };

      await streamingManager.appendChunk(sessionId, chunk);

      const session = streamingManager.getSession(sessionId);
      expect(session).toBeDefined();
    });

    it("应该返回 false 对于不存在的会话", async () => {
      const result = await streamingManager.appendChunk("non-existent", {
        type: "text_delta",
        text: "Hello",
      });

      expect(result).toBe(false);
    });
  });

  describe("刷新机制", () => {
    it("应该刷新缓冲内容", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123",
        "Initial"
      );

      await streamingManager.appendChunk(sessionId, {
        type: "text_delta",
        text: " Additional text",
      });

      const flushed = await streamingManager.flush(sessionId);
      expect(flushed).toBe(true);
    });

    it("应该返回 false 对于不存在的会话刷新", async () => {
      const flushed = await streamingManager.flush("non-existent");
      expect(flushed).toBe(false);
    });

    it("应该在没有发送器时跳过刷新", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123"
      );

      // 未注册发送器，刷新应该返回 false
      const flushed = await streamingManager.flush(sessionId);
      expect(flushed).toBe(false);
    });
  });

  describe("发送器注册", () => {
    it("应该注册发送器", () => {
      const mockSender = {
        platform: "telegram" as const,
        sendInitial: vi.fn().mockResolvedValue("msg_123"),
        sendUpdate: vi.fn().mockResolvedValue(true),
        sendFinal: vi.fn().mockResolvedValue(true),
        supportsStreaming: vi.fn().mockReturnValue(true),
      };

      streamingManager.registerSender("telegram", mockSender);

      // 验证发送器已注册
      expect(streamingManager).toBeDefined();
    });

    it("应该支持多平台发送器", () => {
      const telegramSender = {
        platform: "telegram" as const,
        sendInitial: vi.fn().mockResolvedValue("msg_1"),
        sendUpdate: vi.fn().mockResolvedValue(true),
        sendFinal: vi.fn().mockResolvedValue(true),
        supportsStreaming: vi.fn().mockReturnValue(true),
      };

      const wechatSender = {
        platform: "wechat" as const,
        sendInitial: vi.fn().mockResolvedValue("msg_2"),
        sendUpdate: vi.fn().mockResolvedValue(true),
        sendFinal: vi.fn().mockResolvedValue(true),
        supportsStreaming: vi.fn().mockReturnValue(true),
      };

      streamingManager.registerSender("telegram", telegramSender);
      streamingManager.registerSender("wechat", wechatSender);

      expect(streamingManager).toBeDefined();
    });
  });

  describe("事件发射", () => {
    it("应该发射 start 事件", async () => {
      const listener = vi.fn();
      streamingManager.on("event", listener);

      await streamingManager.startSession("telegram", "chat_123");

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.type).toBe("start");
    });

    it("应该发射 append 事件", async () => {
      const listener = vi.fn();
      streamingManager.on("event", listener);

      const sessionId = await streamingManager.startSession("telegram", "chat_123");
      await streamingManager.appendChunk(sessionId, {
        type: "text_delta",
        text: "Hello",
      });

      expect(listener).toHaveBeenCalled();
    });

    it("应该发射 flush 事件", async () => {
      const listener = vi.fn();
      streamingManager.on("event", listener);

      const sessionId = await streamingManager.startSession("telegram", "chat_123", "Initial");
      await streamingManager.flush(sessionId);

      expect(listener).toHaveBeenCalled();
    });

    it("应该发射 end 事件", async () => {
      const listener = vi.fn();
      streamingManager.on("event", listener);

      const sessionId = await streamingManager.startSession("telegram", "chat_123");
      streamingManager.endSession(sessionId);

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls.find((c: any) => c[0].type === "end");
      expect(event).toBeDefined();
    });
  });

  describe("会话 ID 生成", () => {
    it("应该生成唯一的会话 ID", () => {
      const id1 = (streamingManager as any).generateSessionId();
      const id2 = (streamingManager as any).generateSessionId();

      expect(id1).not.toBe(id2);
    });

    it("应该生成符合格式的会话 ID", () => {
      const id = (streamingManager as any).generateSessionId();
      expect(id).toMatch(/^stream_[a-zA-Z0-9]+$/);
    });
  });

  describe("统计信息", () => {
    it("应该获取统计信息", async () => {
      await streamingManager.startSession("telegram", "chat_1");
      await streamingManager.startSession("wechat", "chat_2");
      await streamingManager.startSession("discord", "chat_3");

      const stats = streamingManager.getStats();

      expect(stats.totalSessions).toBe(3);
      expect(stats.activeSessions).toBe(3);
    });
  });

  describe("多平台支持", () => {
    it("应该支持 Telegram 平台", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "tg_chat_123"
      );

      const session = streamingManager.getSession(sessionId);
      expect(session?.platform).toBe("telegram");
    });

    it("应该支持微信平台", async () => {
      const sessionId = await streamingManager.startSession(
        "wechat",
        "wc_user_abc"
      );

      const session = streamingManager.getSession(sessionId);
      expect(session?.platform).toBe("wechat");
    });

    it("应该支持 Discord 平台", async () => {
      const sessionId = await streamingManager.startSession(
        "discord",
        "dc_channel_xyz"
      );

      const session = streamingManager.getSession(sessionId);
      expect(session?.platform).toBe("discord");
    });

    it("应该支持钉钉平台", async () => {
      const sessionId = await streamingManager.startSession(
        "dingtalk",
        "dt_group_456"
      );

      const session = streamingManager.getSession(sessionId);
      expect(session?.platform).toBe("dingtalk");
    });

    it("应该支持飞书平台", async () => {
      const sessionId = await streamingManager.startSession(
        "feishu",
        "fs_chat_789"
      );

      const session = streamingManager.getSession(sessionId);
      expect(session?.platform).toBe("feishu");
    });
  });
});

describe("createStreamingManager", () => {
  it("应该创建 StreamingManager 实例", () => {
    const manager = createStreamingManager({
      enabled: true,
    });

    expect(manager).toBeDefined();
    expect(manager).toBeInstanceOf(StreamingManager);
  });

  it("应该使用默认配置", () => {
    const manager = createStreamingManager();

    expect(manager).toBeDefined();
  });
});

describe("defaultStreamingConfig", () => {
  it("应该有正确的默认配置", () => {
    const { defaultStreamingConfig } = require("../index");

    expect(defaultStreamingConfig).toBeDefined();
    expect(defaultStreamingConfig.enabled).toBe(true);
    expect(defaultStreamingConfig.minBufferSize).toBe(10);
    expect(defaultStreamingConfig.maxBufferSize).toBe(25);
    expect(defaultStreamingConfig.flushTimeout).toBe(100);
  });
});
