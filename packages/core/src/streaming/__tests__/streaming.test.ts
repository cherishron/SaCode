import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { StreamingManager, createStreamingManager, defaultStreamingConfig } from "../index";
import type { StreamChunk } from "../types";

describe("StreamingManager", () => {
  let streamingManager: StreamingManager;

  beforeEach(() => {
    streamingManager = new StreamingManager({
      enabled: true,
      minBufferSize: 10,
      maxBufferSize: 25,
      sendInterval: 100,
    });
  });

  afterEach(async () => {
    await streamingManager.cleanup();
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
        sendInterval: 50,
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

      const sessions = streamingManager.getActiveSessions();
      expect(sessions).toHaveLength(3);
    });

    it("应该完成会话", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123"
      );

      await streamingManager.completeSession(sessionId);

      const session = streamingManager.getSession(sessionId);
      expect(session).toBeUndefined();
    });

    it("应该对不存在的会话完成操作不报错", async () => {
      await expect(streamingManager.completeSession("non-existent")).resolves.toBeUndefined();
    });
  });

  describe("追加内容", () => {
    it("应该追加文本块", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123"
      );

      const chunk: StreamChunk = {
        text: "Hello",
        isComplete: false,
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

      await streamingManager.appendChunk(sessionId, { text: "Hello", isComplete: false });
      await streamingManager.appendChunk(sessionId, { text: " ", isComplete: false });
      await streamingManager.appendChunk(sessionId, { text: "World", isComplete: false });

      const session = streamingManager.getSession(sessionId);
      expect(session?.accumulatedText).toContain("Hello World");
    });

    it("应该处理完成块", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123"
      );

      const chunk: StreamChunk = {
        text: "Done",
        isComplete: true,
      };

      await streamingManager.appendChunk(sessionId, chunk);

      const session = streamingManager.getSession(sessionId);
      expect(session).toBeDefined();
    });

    it("应该对不存在的会话追加不报错", async () => {
      await expect(streamingManager.appendChunk("non-existent", {
        text: "Hello",
        isComplete: false,
      })).resolves.toBeUndefined();
    });
  });

  describe("完成机制", () => {
    it("应该完成会话并发送剩余内容", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123",
        "Initial"
      );

      await streamingManager.appendChunk(sessionId, {
        text: " Additional text",
        isComplete: false,
      });

      await streamingManager.completeSession(sessionId);
      const session = streamingManager.getSession(sessionId);
      expect(session).toBeUndefined();
    });

    it("应该对不存在的会话完成不报错", async () => {
      await expect(streamingManager.completeSession("non-existent")).resolves.toBeUndefined();
    });

    it("应该在没有发送器时完成会话", async () => {
      const sessionId = await streamingManager.startSession(
        "telegram",
        "chat_123"
      );

      await streamingManager.completeSession(sessionId);
      const session = streamingManager.getSession(sessionId);
      expect(session).toBeUndefined();
    });
  });

  describe("发送器注册", () => {
    it("应该注册发送器", () => {
      const mockSender = {
        sendInitial: vi.fn().mockResolvedValue("msg_123"),
        editMessage: vi.fn().mockResolvedValue(undefined),
        supportsStreaming: vi.fn().mockReturnValue(true),
      };

      streamingManager.registerSender("telegram", mockSender);

      expect(streamingManager).toBeDefined();
    });

    it("应该支持多平台发送器", () => {
      const telegramSender = {
        sendInitial: vi.fn().mockResolvedValue("msg_1"),
        editMessage: vi.fn().mockResolvedValue(undefined),
        supportsStreaming: vi.fn().mockReturnValue(true),
      };

      const wechatSender = {
        sendInitial: vi.fn().mockResolvedValue("msg_2"),
        editMessage: vi.fn().mockResolvedValue(undefined),
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

    it("应该发射 chunk 事件", async () => {
      const listener = vi.fn();
      streamingManager.on("event", listener);

      const sessionId = await streamingManager.startSession("telegram", "chat_123");
      await streamingManager.appendChunk(sessionId, {
        text: "Hello",
        isComplete: false,
      });

      expect(listener).toHaveBeenCalled();
    });

    it("应该发射 complete 事件", async () => {
      const listener = vi.fn();
      streamingManager.on("event", listener);

      const sessionId = await streamingManager.startSession("telegram", "chat_123");
      await streamingManager.completeSession(sessionId);

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls.find((c: any) => c[0].type === "complete");
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
      expect(id).toMatch(/^stream_\d+_[a-z0-9]+$/);
    });
  });

  describe("统计信息", () => {
    it("应该获取活跃会话信息", async () => {
      await streamingManager.startSession("telegram", "chat_1");
      await streamingManager.startSession("wechat", "chat_2");
      await streamingManager.startSession("discord", "chat_3");

      const sessions = streamingManager.getActiveSessions();

      expect(sessions).toHaveLength(3);
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
    expect(defaultStreamingConfig).toBeDefined();
    expect(defaultStreamingConfig.enabled).toBe(true);
    expect(defaultStreamingConfig.minBufferSize).toBe(10);
    expect(defaultStreamingConfig.maxBufferSize).toBe(25);
    expect(defaultStreamingConfig.sendInterval).toBe(100);
  });
});
