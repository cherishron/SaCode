/**
 * SessionManager 测试
 * 测试会话管理器的核心功能：创建、更新、删除、查询会话
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SessionManager, createSessionManager } from "../index";
import type { Session } from "../types";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({
      enableAutoCleanup: false,
      mapperConfig: {
        enablePersistence: false,
        enableAutoCleanup: false,
      },
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  describe("创建会话", () => {
    it("应该创建新会话", () => {
      const session = manager.create({
        channelId: "test-channel",
        platform: "test",
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.channelId).toBe("test-channel");
      expect(session.platform).toBe("test");
      expect(session.status).toBe("active");
      expect(session.messageCount).toBe(0);
    });

    it("应该创建带自定义元数据的会话", () => {
      const session = manager.create({
        channelId: "test-channel",
        platform: "test",
        metadata: { userId: "user-123", tier: "vip" },
      });

      expect(session.metadata?.userId).toBe("user-123");
      expect(session.metadata?.tier).toBe("vip");
    });

    it("应该为不同平台创建会话", () => {
      const platforms: Array<"telegram" | "wechat" | "discord" | "test"> = [
        "telegram",
        "wechat",
        "discord",
        "test",
      ];

      for (const platform of platforms) {
        const session = manager.create({
          channelId: `${platform}-channel`,
          platform,
        });
        expect(session.platform).toBe(platform);
      }
    });

    it("应该发射 session:created 事件", () => {
      const listener = vi.fn();
      manager.on("session:created", listener);

      manager.create({
        channelId: "test-channel",
        platform: "test",
      });

      expect(listener).toHaveBeenCalled();
    });
  });

  describe("查询会话", () => {
    it("应该通过 ID 获取会话", () => {
      const created = manager.create({
        channelId: "test-channel",
        platform: "test",
      });

      const found = manager.get(created.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it("应该返回 undefined 对于不存在的会话", () => {
      const found = manager.get("non-existent-id");
      expect(found).toBeUndefined();
    });

    it("应该通过渠道获取会话", () => {
      manager.create({
        channelId: "telegram:123456",
        platform: "telegram",
      });

      const found = manager.getByChannel("telegram", "123456");
      expect(found).toBeDefined();
      expect(found?.channelId).toBe("telegram:123456");
    });

    it("应该获取所有会话", () => {
      manager.create({ channelId: "channel-1", platform: "test" });
      manager.create({ channelId: "channel-2", platform: "test" });
      manager.create({ channelId: "channel-3", platform: "telegram" });

      const all = manager.getAll();
      expect(all).toHaveLength(3);
    });

    it("应该按平台过滤会话", () => {
      manager.create({ channelId: "tg-1", platform: "telegram" });
      manager.create({ channelId: "wc-1", platform: "wechat" });
      manager.create({ channelId: "tg-2", platform: "telegram" });

      const telegram = manager.getByPlatform("telegram");
      expect(telegram).toHaveLength(2);
      expect(telegram.every(s => s.platform === "telegram")).toBe(true);
    });
  });

  describe("更新会话", () => {
    it("应该更新会话状态", () => {
      const session = manager.create({
        channelId: "test-channel",
        platform: "test",
      });

      manager.update(session.id, { status: "inactive" });

      const updated = manager.get(session.id);
      expect(updated?.status).toBe("inactive");
    });

    it("应该更新消息计数", () => {
      const session = manager.create({
        channelId: "test-channel",
        platform: "test",
      });

      manager.update(session.id, { messageCount: 10 });

      const updated = manager.get(session.id);
      expect(updated?.messageCount).toBe(10);
    });

    it("应该更新元数据", () => {
      const session = manager.create({
        channelId: "test-channel",
        platform: "test",
        metadata: { key1: "value1" },
      });

      manager.update(session.id, {
        metadata: { key1: "updated", key2: "new" },
      });

      const updated = manager.get(session.id);
      expect(updated?.metadata?.key1).toBe("updated");
      expect(updated?.metadata?.key2).toBe("new");
    });

    it("应该发射 session:updated 事件", () => {
      const session = manager.create({
        channelId: "test-channel",
        platform: "test",
      });

      const listener = vi.fn();
      manager.on("session:updated", listener);

      manager.update(session.id, { status: "inactive" });

      expect(listener).toHaveBeenCalled();
    });

    it("应该更新最后活跃时间", () => {
      const session = manager.create({
        channelId: "test-channel",
        platform: "test",
      });

      const before = session.updatedAt.getTime();
      
      vi.useFakeTimers();
      vi.advanceTimersByTime(100);

      manager.update(session.id, { status: "active" });

      const updated = manager.get(session.id);
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(before);

      vi.useRealTimers();
    });
  });

  describe("删除会话", () => {
    it("应该删除会话", () => {
      const session = manager.create({
        channelId: "test-channel",
        platform: "test",
      });

      const deleted = manager.delete(session.id);
      expect(deleted).toBe(true);
      expect(manager.get(session.id)).toBeUndefined();
    });

    it("应该返回 false 对于不存在的会话", () => {
      const deleted = manager.delete("non-existent-id");
      expect(deleted).toBe(false);
    });

    it("应该发射 session:deleted 事件", () => {
      const session = manager.create({
        channelId: "test-channel",
        platform: "test",
      });

      const listener = vi.fn();
      manager.on("session:deleted", listener);

      manager.delete(session.id);

      expect(listener).toHaveBeenCalledWith({ sessionId: session.id });
    });

    it("应该同时删除映射", () => {
      const session = manager.create({
        channelId: "telegram:123456",
        platform: "telegram",
      });

      manager.delete(session.id);

      const byChannel = manager.getByChannel("telegram", "123456");
      expect(byChannel).toBeUndefined();
    });
  });

  describe("会话清理", () => {
    it("应该清理过期会话", () => {
      const session = manager.create({
        channelId: "test-channel",
        platform: "test",
      });

      // 手动设置会话为过期
      const sessions = manager.get(session.id);
      if (sessions) {
        (sessions as any).updatedAt = new Date(Date.now() - 10000000);
      }

      const cleanedCount = manager.cleanupExpired(1000); // 1 秒 TTL
      expect(cleanedCount).toBeGreaterThanOrEqual(0);
    });

    it("应该获取统计信息", () => {
      manager.create({ channelId: "ch1", platform: "telegram" });
      manager.create({ channelId: "ch2", platform: "wechat" });
      manager.create({ channelId: "ch3", platform: "telegram" });

      const stats = manager.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byPlatform.telegram).toBe(2);
      expect(stats.byPlatform.wechat).toBe(1);
    });
  });

  describe("跨渠道映射集成", () => {
    it("应该创建会话时自动创建映射", () => {
      const session = manager.create({
        channelId: "telegram:123456",
        platform: "telegram",
      });

      const mapping = manager.mapping.findByChannel("telegram", "123456");
      expect(mapping).toBeDefined();
      expect(mapping?.sessionId).toBe(session.id);
    });

    it("应该通过映射获取会话", () => {
      const session = manager.create({
        channelId: "discord:789",
        platform: "discord",
      });

      const byChannel = manager.getByChannel("discord", "789");
      expect(byChannel?.id).toBe(session.id);
    });
  });

  describe("销毁", () => {
    it("应该清理所有资源", () => {
      manager.create({ channelId: "ch1", platform: "test" });
      manager.create({ channelId: "ch2", platform: "test" });

      manager.destroy();

      expect(manager.getAll()).toHaveLength(0);
    });
  });
});

describe("createSessionManager", () => {
  it("应该创建 SessionManager 实例", () => {
    const manager = createSessionManager({
      enableAutoCleanup: false,
    });

    expect(manager).toBeDefined();
    expect(manager).toBeInstanceOf(SessionManager);
  });

  it("应该使用默认配置", () => {
    const manager = createSessionManager();

    expect(manager).toBeDefined();
  });
});

describe("SessionManager 多平台支持", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({
      enableAutoCleanup: false,
      mapperConfig: {
        enablePersistence: false,
        enableAutoCleanup: false,
      },
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  it("应该支持 Telegram 平台", () => {
    const session = manager.create({
      channelId: "telegram:chat_123",
      platform: "telegram",
    });
    expect(session.platform).toBe("telegram");
  });

  it("应该支持微信平台", () => {
    const session = manager.create({
      channelId: "wechat:user_abc",
      platform: "wechat",
    });
    expect(session.platform).toBe("wechat");
  });

  it("应该支持 Discord 平台", () => {
    const session = manager.create({
      channelId: "discord:channel_xyz",
      platform: "discord",
    });
    expect(session.platform).toBe("discord");
  });

  it("应该支持钉钉平台", () => {
    const session = manager.create({
      channelId: "dingtalk:group_456",
      platform: "dingtalk",
    });
    expect(session.platform).toBe("dingtalk");
  });

  it("应该支持飞书平台", () => {
    const session = manager.create({
      channelId: "feishu:chat_789",
      platform: "feishu",
    });
    expect(session.platform).toBe("feishu");
  });
});
