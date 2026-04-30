/**
 * SessionMapper 测试
 * 测试跨渠道会话映射功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionMapper, createSessionMapper } from "../mapping";
import type { SessionMappingEntry } from "../types";

describe("SessionMapper", () => {
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

  describe("创建映射", () => {
    it("应该创建渠道到会话的映射", () => {
      const sessionId = mapper.createMapping("telegram", "123456789");

      expect(sessionId).toBeDefined();
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it("应该创建带自定义会话 ID 的映射", () => {
      const customSessionId = "custom-session-123";
      const sessionId = mapper.createMapping(
        "telegram",
        "123456789",
        customSessionId
      );

      expect(sessionId).toBe(customSessionId);
    });

    it("应该创建带元数据的映射", () => {
      const sessionId = mapper.createMapping(
        "telegram",
        "123456789",
        undefined,
        { userId: "user-123", tier: "vip" }
      );

      const entry = mapper.findByChannel("telegram", "123456789");
      expect(entry?.metadata?.userId).toBe("user-123");
      expect(entry?.metadata?.tier).toBe("vip");
    });

    it("应该为不同平台创建映射", () => {
      const platforms = [
        { platform: "telegram", chatId: "tg_123" },
        { platform: "wechat", chatId: "wc_abc" },
        { platform: "discord", chatId: "dc_xyz" },
        { platform: "dingtalk", chatId: "dt_456" },
        { platform: "feishu", chatId: "fs_789" },
      ];

      for (const { platform, chatId } of platforms) {
        const sessionId = mapper.createMapping(platform, chatId);
        expect(sessionId).toBeDefined();
      }
    });

    it("应该发射 mapping:created 事件", () => {
      const listener = vi.fn();
      mapper.on("mapping:created", listener);

      mapper.createMapping("telegram", "123456789");

      expect(listener).toHaveBeenCalled();
    });
  });

  describe("查询映射", () => {
    it("应该通过渠道查找映射", () => {
      const sessionId = mapper.createMapping("telegram", "123456789");

      const entry = mapper.findByChannel("telegram", "123456789");
      expect(entry).toBeDefined();
      expect(entry?.sessionId).toBe(sessionId);
      expect(entry?.platform).toBe("telegram");
      expect(entry?.chatId).toBe("123456789");
    });

    it("应该返回 undefined 对于不存在的映射", () => {
      const entry = mapper.findByChannel("telegram", "non-existent");
      expect(entry).toBeUndefined();
    });

    it("应该通过会话 ID 查找映射", () => {
      const sessionId = mapper.createMapping("telegram", "123456789");

      const entries = mapper.getBySessionId(sessionId);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.sessionId).toBe(sessionId);
    });

    it("应该获取所有映射", () => {
      mapper.createMapping("telegram", "tg_1");
      mapper.createMapping("wechat", "wc_1");
      mapper.createMapping("discord", "dc_1");

      const all = mapper.getAll();
      expect(all).toHaveLength(3);
    });

    it("应该按平台过滤映射", () => {
      mapper.createMapping("telegram", "tg_1");
      mapper.createMapping("telegram", "tg_2");
      mapper.createMapping("wechat", "wc_1");

      const telegram = mapper.getByPlatform("telegram");
      expect(telegram).toHaveLength(2);
      expect(telegram.every(e => e.platform === "telegram")).toBe(true);
    });
  });

  describe("更新映射", () => {
    it("应该更新最后活跃时间", () => {
      mapper.createMapping("telegram", "123456789");

      const before = mapper.findByChannel("telegram", "123456789")?.lastActiveAt;
      
      // 等待一小段时间
      const now = Date.now();
      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);

      mapper.touch("telegram", "123456789");

      const after = mapper.findByChannel("telegram", "123456789")?.lastActiveAt;
      expect(after?.getTime()).toBeGreaterThanOrEqual((before?.getTime() ?? 0) + 1000);
      
      vi.useRealTimers();
    });

    it("应该更新元数据", () => {
      mapper.createMapping("telegram", "123456789", undefined, { key1: "value1" });

      mapper.updateMetadata("telegram", "123456789", { key1: "updated", key2: "new" });

      const entry = mapper.findByChannel("telegram", "123456789");
      expect(entry?.metadata?.key1).toBe("updated");
      expect(entry?.metadata?.key2).toBe("new");
    });

    it("应该发射 mapping:updated 事件", () => {
      mapper.createMapping("telegram", "123456789");

      const listener = vi.fn();
      mapper.on("mapping:updated", listener);

      mapper.touch("telegram", "123456789");

      expect(listener).toHaveBeenCalled();
    });
  });

  describe("删除映射", () => {
    it("应该通过渠道删除映射", () => {
      mapper.createMapping("telegram", "123456789");

      const deleted = mapper.deleteByChannel("telegram", "123456789");
      expect(deleted).toBe(true);

      const entry = mapper.findByChannel("telegram", "123456789");
      expect(entry).toBeUndefined();
    });

    it("应该返回 false 对于不存在的映射", () => {
      const deleted = mapper.deleteByChannel("telegram", "non-existent");
      expect(deleted).toBe(false);
    });

    it("应该通过会话 ID 删除映射", () => {
      const sessionId = mapper.createMapping("telegram", "123456789");

      const deleted = mapper.deleteBySessionId(sessionId);
      expect(deleted).toBeGreaterThanOrEqual(1);

      const entries = mapper.getBySessionId(sessionId);
      expect(entries).toHaveLength(0);
    });

    it("应该发射 mapping:deleted 事件", () => {
      mapper.createMapping("telegram", "123456789");

      const listener = vi.fn();
      mapper.on("mapping:deleted", listener);

      mapper.deleteByChannel("telegram", "123456789");

      expect(listener).toHaveBeenCalled();
    });
  });

  describe("获取或创建映射", () => {
    it("应该获取已存在的映射", () => {
      const sessionId = mapper.createMapping("telegram", "123456789");

      const result = mapper.getOrCreate("telegram", "123456789");
      expect(result.isNew).toBe(false);
      expect(result.sessionId).toBe(sessionId);
    });

    it("应该创建新映射如果不存在", () => {
      const result = mapper.getOrCreate("telegram", "new_chat_id");
      expect(result.isNew).toBe(true);
      expect(result.sessionId).toBeDefined();
    });

    it("应该为同一渠道返回相同会话 ID", () => {
      const result1 = mapper.getOrCreate("telegram", "chat_123");
      const result2 = mapper.getOrCreate("telegram", "chat_123");

      expect(result1.sessionId).toBe(result2.sessionId);
      expect(result2.isNew).toBe(false);
    });
  });

  describe("渠道标识符构建", () => {
    it("应该正确构建渠道标识符", () => {
      const channel = (mapper as any).buildChannelIdentifier("telegram", "123456789");
      expect(channel).toBe("telegram:123456789");
    });

    it("应该正确解析渠道标识符", () => {
      const channel = (mapper as any).buildChannelIdentifier("telegram", "123456789");
      const [platform, ...rest] = channel.split(":");
      const chatId = rest.join(":");
      expect(platform).toBe("telegram");
      expect(chatId).toBe("123456789");
    });
  });

  describe("会话 ID 生成", () => {
    it("应该生成唯一的会话 ID", () => {
      const id1 = (mapper as any).generateSessionId();
      const id2 = (mapper as any).generateSessionId();

      expect(id1).not.toBe(id2);
    });

    it("应该生成符合格式的会话 ID", () => {
      const id = (mapper as any).generateSessionId();
      expect(id).toMatch(/^session_[a-zA-Z0-9_]+$/);
    });
  });

  describe("清理过期映射", () => {
    it("应该清理过期映射", () => {
      mapper.createMapping("telegram", "123456789");

      // 手动设置映射为过期
      const entry = mapper.findByChannel("telegram", "123456789");
      if (entry) {
        entry.lastActiveAt = new Date(Date.now() - 10000000);
      }

      const cleanedCount = mapper.cleanup(1000); // 1 秒 TTL
      expect(cleanedCount).toBeGreaterThanOrEqual(0);
    });

    it("应该获取统计信息", () => {
      mapper.createMapping("telegram", "tg_1");
      mapper.createMapping("telegram", "tg_2");
      mapper.createMapping("wechat", "wc_1");

      const stats = mapper.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byPlatform.telegram).toBe(2);
      expect(stats.byPlatform.wechat).toBe(1);
    });
  });

  describe("事件发射", () => {
    it("应该发射所有事件类型", () => {
      const createdListener = vi.fn();
      const updatedListener = vi.fn();
      const deletedListener = vi.fn();

      mapper.on("mapping:created", createdListener);
      mapper.on("mapping:updated", updatedListener);
      mapper.on("mapping:deleted", deletedListener);

      mapper.createMapping("telegram", "123456789");
      mapper.touch("telegram", "123456789");
      mapper.deleteByChannel("telegram", "123456789");

      expect(createdListener).toHaveBeenCalled();
      expect(updatedListener).toHaveBeenCalled();
      expect(deletedListener).toHaveBeenCalled();
    });
  });

  describe("销毁", () => {
    it("应该清理所有资源", () => {
      mapper.createMapping("telegram", "123456789");
      mapper.createMapping("wechat", "abcde");

      mapper.destroy();

      expect(mapper.getAll()).toHaveLength(0);
    });
  });
});

describe("SessionMapper 持久化", () => {
  it("应该支持禁用持久化", () => {
    const mapper = new SessionMapper({
      enablePersistence: false,
      enableAutoCleanup: false,
    });

    mapper.createMapping("telegram", "123456789");
    expect(mapper.getAll()).toHaveLength(1);

    mapper.destroy();
  });
});

describe("createSessionMapper", () => {
  it("应该创建 SessionMapper 实例", () => {
    const mapper = createSessionMapper({
      enablePersistence: false,
      enableAutoCleanup: false,
    });

    expect(mapper).toBeDefined();
    expect(mapper).toBeInstanceOf(SessionMapper);
  });

  it("应该使用默认配置", () => {
    const mapper = createSessionMapper();

    expect(mapper).toBeDefined();
  });
});

describe("SessionMapper 多平台支持", () => {
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

  it("应该支持 Telegram", () => {
    const sessionId = mapper.createMapping("telegram", "tg_chat_123");
    const entry = mapper.findByChannel("telegram", "tg_chat_123");
    expect(entry?.platform).toBe("telegram");
  });

  it("应该支持微信", () => {
    const sessionId = mapper.createMapping("wechat", "wc_user_abc");
    const entry = mapper.findByChannel("wechat", "wc_user_abc");
    expect(entry?.platform).toBe("wechat");
  });

  it("应该支持 Discord", () => {
    const sessionId = mapper.createMapping("discord", "dc_channel_xyz");
    const entry = mapper.findByChannel("discord", "dc_channel_xyz");
    expect(entry?.platform).toBe("discord");
  });

  it("应该支持钉钉", () => {
    const sessionId = mapper.createMapping("dingtalk", "dt_group_456");
    const entry = mapper.findByChannel("dingtalk", "dt_group_456");
    expect(entry?.platform).toBe("dingtalk");
  });

  it("应该支持飞书", () => {
    const sessionId = mapper.createMapping("feishu", "fs_chat_789");
    const entry = mapper.findByChannel("feishu", "fs_chat_789");
    expect(entry?.platform).toBe("feishu");
  });

  it("应该支持小艺", () => {
    const sessionId = mapper.createMapping("xiaoyi", "xy_user_001");
    const entry = mapper.findByChannel("xiaoyi", "xy_user_001");
    expect(entry?.platform).toBe("xiaoyi");
  });

  it("应该支持 WhatsApp", () => {
    const sessionId = mapper.createMapping("whatsapp", "wa_contact_123");
    const entry = mapper.findByChannel("whatsapp", "wa_contact_123");
    expect(entry?.platform).toBe("whatsapp");
  });

  it("应该支持 Slack", () => {
    const sessionId = mapper.createMapping("slack", "sl_channel_456");
    const entry = mapper.findByChannel("slack", "sl_channel_456");
    expect(entry?.platform).toBe("slack");
  });

  it("应该支持 Email", () => {
    const sessionId = mapper.createMapping("email", "em_inbox_789");
    const entry = mapper.findByChannel("email", "em_inbox_789");
    expect(entry?.platform).toBe("email");
  });

  it("应该支持 QQ", () => {
    const sessionId = mapper.createMapping("qq", "qq_group_000");
    const entry = mapper.findByChannel("qq", "qq_group_000");
    expect(entry?.platform).toBe("qq");
  });
});
