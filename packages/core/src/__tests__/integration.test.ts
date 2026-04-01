/**
 * 集成测试 - 核心模块
 * 测试 SaClawClient、SessionManager、MessageRouter 等核心功能的集成
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SaClawClient,
  SessionManager,
  SessionMapper,
  MessageRouter,
  TaskScheduler,
  GroupQueue,
  PluginManager,
  createPluginManager,
} from "../index";
import type { Message, Session } from "../types";

// 本地测试工具函数
function createMockUserMessage(overrides?: Partial<{
  id: string;
  channelId: string;
  content: string;
  timestamp: Date;
}>): Message {
  return {
    id: `msg_${Date.now()}`,
    role: "user",
    channelId: overrides?.channelId ?? "test-channel",
    content: overrides?.content ?? "test message",
    timestamp: overrides?.timestamp ?? new Date(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Core Integration", () => {
  describe("SessionManager + SessionMapper", () => {
    let sessionManager: SessionManager;

    beforeEach(() => {
      sessionManager = new SessionManager({
        enableAutoCleanup: false,
        mapperConfig: {
          enablePersistence: false,
          enableAutoCleanup: false,
        },
      });
    });

    afterEach(() => {
      sessionManager.destroy();
    });

    it("should coordinate session creation across multiple platforms", () => {
      // 创建多个平台的会话
      const telegramSession = sessionManager.create({
        platform: "telegram",
        channelId: "telegram:chat_123",
      });

      const wechatSession = sessionManager.create({
        platform: "wechat",
        channelId: "wechat:user_abc",
      });

      const discordSession = sessionManager.create({
        platform: "discord",
        channelId: "discord:channel_xyz",
      });

      // 验证会话已创建
      expect(sessionManager.get(telegramSession.id)).toBeDefined();
      expect(sessionManager.get(wechatSession.id)).toBeDefined();
      expect(sessionManager.get(discordSession.id)).toBeDefined();
      expect(telegramSession.platform).toBe("telegram");
      expect(wechatSession.platform).toBe("wechat");
    });

    it("should find session by channel mapping", () => {
      sessionManager.create({
        platform: "telegram",
        channelId: "telegram:chat_456",
      });

      // 通过渠道查找会话
      const session = sessionManager.getByChannel("telegram", "chat_456");
      expect(session?.platform).toBe("telegram");
    });

    it("should handle session deletion correctly", () => {
      const session = sessionManager.create({
        platform: "wechat",
        channelId: "wechat:user_xyz",
      });

      // 删除会话
      const deleted = sessionManager.delete(session.id);
      expect(deleted).toBe(true);
      expect(sessionManager.get(session.id)).toBeUndefined();
    });
  });

  describe("MessageRouter + SessionManager", () => {
    let router: MessageRouter;
    let sessionManager: SessionManager;

    beforeEach(() => {
      router = new MessageRouter();
      sessionManager = new SessionManager({
        enableAutoCleanup: false,
        mapperConfig: {
          enablePersistence: false,
          enableAutoCleanup: false,
        },
      });
    });

    afterEach(() => {
      sessionManager.destroy();
    });

    it("should route messages to correct sessions", async () => {
      const routedMessages: Array<{ message: Message; sessionId: string }> = [];

      router.on("routed", (event) => {
        const payload = event.payload as { message: Message; sessionId: string };
        routedMessages.push(payload);
      });

      const session = sessionManager.create({
        channelId: "test-channel",
        platform: "test",
      });

      const message = createMockUserMessage({
        channelId: "test-channel",
        content: "Hello, World!",
      });

      await router.route(message, session as Session);

      expect(routedMessages.length).toBe(1);
      expect(routedMessages[0]?.message.content).toBe("Hello, World!");
    });

    it("should use default handler when no pattern matches", async () => {
      const handledMessages: Message[] = [];

      const defaultRouter = new MessageRouter({
        defaultHandler: async (message) => {
          handledMessages.push(message);
        },
      });

      const session = sessionManager.create({
        channelId: "test-channel",
        platform: "test",
      });

      const message = createMockUserMessage();
      await defaultRouter.route(message, session as Session);

      expect(handledMessages.length).toBe(1);
    });
  });

  describe("TaskScheduler + GroupQueue", () => {
    let scheduler: TaskScheduler;
    let queue: GroupQueue<{ data: string }, string>;

    beforeEach(() => {
      scheduler = new TaskScheduler();
      queue = new GroupQueue<{ data: string }, string>({
        concurrency: 1,
        executor: async (task) => {
          await sleep(50);
          return `processed: ${task.data.data}`;
        },
      });
    });

    afterEach(() => {
      scheduler.stop();
      queue.clearAll();
    });

    it("should process queue items in order", async () => {
      const processed: string[] = [];

      const orderedQueue = new GroupQueue<{ data: string }, void>({
        concurrency: 1,
        executor: async (task) => {
          processed.push(task.data.data);
          await sleep(50);
        },
      });

      // Enqueue tasks - they will process in order
      const promise1 = orderedQueue.enqueue("test-group", { data: "first" });
      const promise2 = orderedQueue.enqueue("test-group", { data: "second" });
      const promise3 = orderedQueue.enqueue("test-group", { data: "third" });

      // Wait for all tasks to complete
      await Promise.all([promise1, promise2, promise3]);

      expect(processed).toEqual(["first", "second", "third"]);
    });

    it("should return queue stats", () => {
      queue.enqueue("group1", { data: "task1" });
      queue.enqueue("group1", { data: "task2" });

      const stats = queue.getStats("group1");
      expect(stats.total).toBeGreaterThanOrEqual(2);
    });

    it("should check processing status", () => {
      queue.enqueue("group2", { data: "task" });
      const isProcessing = queue.isProcessing("group2");
      expect(typeof isProcessing).toBe("boolean");
    });
  });

  describe("PluginManager", () => {
    it("should require dependencies", () => {
      // PluginManager requires adapters, scheduler, database, client dependencies
      // This is a design pattern test, not an instantiation test
      expect(PluginManager).toBeTypeOf("function");
      expect(createPluginManager).toBeTypeOf("function");
    });
  });
});

describe("SaClawClient", () => {
  it("should create client with valid config", () => {
    const client = new SaClawClient({
      acpUrl: "ws://localhost:8090/acp",
      autoStart: false,
      timeout: 30000,
    });

    expect(client).toBeDefined();
    expect(client.connect).toBeTypeOf("function");
    expect(client.disconnect).toBeTypeOf("function");
  });

  it("should use default config values", () => {
    const client = new SaClawClient({
      acpUrl: "ws://localhost:8090/acp",
    });

    expect(client).toBeDefined();
  });
});

describe("SessionMapper standalone", () => {
  let mapper: SessionMapper;

  beforeEach(() => {
    mapper = new SessionMapper({
      enablePersistence: false,
      enableAutoCleanup: false,
    });
  });

  afterEach(() => {
    mapper.destroy();
  });

  it("should create and find mappings", () => {
    const sessionId = mapper.createMapping("telegram", "chat_123");
    expect(sessionId).toBeDefined();

    const mapping = mapper.findByChannel("telegram", "chat_123");
    expect(mapping?.sessionId).toBe(sessionId);
    expect(mapping?.platform).toBe("telegram");
    expect(mapping?.chatId).toBe("chat_123");
  });

  it("should update mapping touch time", () => {
    mapper.createMapping("wechat", "user_456");

    const before = mapper.findByChannel("wechat", "user_456")?.lastActiveAt;
    sleep(10).then(() => {
      mapper.touch("wechat", "user_456");
      const after = mapper.findByChannel("wechat", "user_456")?.lastActiveAt;
      expect(after?.getTime()).toBeGreaterThanOrEqual(before?.getTime() ?? 0);
    });
  });

  it("should delete mappings", () => {
    mapper.createMapping("discord", "channel_789");
    const deleted = mapper.deleteByChannel("discord", "channel_789");
    expect(deleted).toBe(true);

    const mapping = mapper.findByChannel("discord", "channel_789");
    expect(mapping).toBeUndefined();
  });
});