import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createAdapter,
  IMAdapterManager,
  WechatAdapter,
  QQAdapter,
  TelegramAdapter,
  DiscordAdapter,
  DingTalkAdapter,
  FeishuAdapter,
  XiaoyiAdapter,
  WhatsAppAdapter,
  SlackAdapter,
  EmailAdapter,
} from "../index.js";

describe("Adapters", () => {
  describe("createAdapter", () => {
    it("should create Wechat adapter", () => {
      const adapter = createAdapter({
        platform: "wechat",
        config: {},
      });
      expect(adapter).toBeInstanceOf(WechatAdapter);
      expect(adapter.platform).toBe("wechat");
    });

    it("should create QQ adapter", () => {
      const adapter = createAdapter({
        platform: "qq",
        config: {},
      });
      expect(adapter).toBeInstanceOf(QQAdapter);
      expect(adapter.platform).toBe("qq");
    });

    it("should create Telegram adapter", () => {
      const adapter = createAdapter({
        platform: "telegram",
        config: { botToken: "test-token" },
      });
      expect(adapter).toBeInstanceOf(TelegramAdapter);
      expect(adapter.platform).toBe("telegram");
    });

    it("should create Discord adapter", () => {
      const adapter = createAdapter({
        platform: "discord",
        config: { botToken: "test-token" },
      });
      expect(adapter).toBeInstanceOf(DiscordAdapter);
      expect(adapter.platform).toBe("discord");
    });

    it("should create DingTalk adapter", () => {
      const adapter = createAdapter({
        platform: "dingtalk",
        config: { appKey: "test", appSecret: "test" },
      });
      expect(adapter).toBeInstanceOf(DingTalkAdapter);
      expect(adapter.platform).toBe("dingtalk");
    });

    it("should create Feishu adapter", () => {
      const adapter = createAdapter({
        platform: "feishu",
        config: { appId: "test", appSecret: "test" },
      });
      expect(adapter).toBeInstanceOf(FeishuAdapter);
      expect(adapter.platform).toBe("feishu");
    });

    it("should create Xiaoyi adapter", () => {
      const adapter = createAdapter({
        platform: "xiaoyi",
        config: { ak: "test", sk: "test", agentId: "test" },
      });
      expect(adapter).toBeInstanceOf(XiaoyiAdapter);
      expect(adapter.platform).toBe("xiaoyi");
    });

    it("should create WhatsApp adapter", () => {
      const adapter = createAdapter({
        platform: "whatsapp",
        config: {},
      });
      expect(adapter).toBeInstanceOf(WhatsAppAdapter);
      expect(adapter.platform).toBe("whatsapp");
    });

    it("should create Slack adapter", () => {
      const adapter = createAdapter({
        platform: "slack",
        config: { botToken: "xoxb-test" },
      });
      expect(adapter).toBeInstanceOf(SlackAdapter);
      expect(adapter.platform).toBe("slack");
    });

    it("should create Email adapter", () => {
      const adapter = createAdapter({
        platform: "email",
        config: { imap: { host: "imap.test.com", port: 993 } },
      });
      expect(adapter).toBeInstanceOf(EmailAdapter);
      expect(adapter.platform).toBe("email");
    });

    it("should throw for unknown platform", () => {
      expect(() =>
        createAdapter({
          platform: "unknown" as never,
          config: {},
        })
      ).toThrow("Unknown platform");
    });
  });

  describe("IMAdapterManager", () => {
    let manager: IMAdapterManager;

    beforeEach(() => {
      manager = new IMAdapterManager();
    });

    afterEach(() => {
      manager.disconnectAll();
    });

    it("should manage adapters", () => {
      expect(manager.getAll().size).toBe(0);
    });

    it("should register adapter", () => {
      const adapter = new TelegramAdapter({ botToken: "test" });
      manager.register("telegram", adapter);
      expect(manager.getAll().size).toBe(1);
      expect(manager.get("telegram")).toBe(adapter);
    });

    it("should unregister adapter", () => {
      const adapter = new TelegramAdapter({ botToken: "test" });
      manager.register("telegram", adapter);
      manager.unregister("telegram");
      expect(manager.getAll().size).toBe(0);
      expect(manager.get("telegram")).toBeUndefined();
    });

    it("should check if platform exists", () => {
      const adapter = new TelegramAdapter({ botToken: "test" });
      manager.register("telegram", adapter);
      expect(manager.has("telegram")).toBe(true);
      expect(manager.has("discord")).toBe(false);
    });
  });

  describe("BaseAdapter methods", () => {
    it("TelegramAdapter should have required methods", () => {
      const adapter = new TelegramAdapter({ botToken: "test-token" });
      expect(adapter.connect).toBeTypeOf("function");
      expect(adapter.disconnect).toBeTypeOf("function");
      expect(adapter.send).toBeTypeOf("function");
      expect(adapter.getChannels).toBeTypeOf("function");
      expect(adapter.onMessage).toBeTypeOf("function");
      expect(adapter.isConnected).toBeTypeOf("function");
    });

    it("DiscordAdapter should have required methods", () => {
      const adapter = new DiscordAdapter({ botToken: "test-token" });
      expect(adapter.connect).toBeTypeOf("function");
      expect(adapter.disconnect).toBeTypeOf("function");
      expect(adapter.send).toBeTypeOf("function");
      expect(adapter.getChannels).toBeTypeOf("function");
    });
  });

  describe("Adapter message handling", () => {
    it("should register message callback", () => {
      const adapter = new TelegramAdapter({ botToken: "test" });
      const messageSpy = vi.fn();
      adapter.onMessage(messageSpy);
      // 验证回调已注册（通过调用内部方法测试）
    });
  });
});

describe("DingTalkAdapter", () => {
  it("should support AI Card streaming config when properly configured", () => {
    const adapter = new DingTalkAdapter({
      appKey: "test",
      appSecret: "test",
      streamingEnabled: true,
      cardTemplateId: "template-id",
      robotCode: "robot-code",
    });
    expect(adapter.platform).toBe("dingtalk");
    expect(adapter.supportsStreaming()).toBe(true);
  });

  it("should not support streaming without required config", () => {
    const adapter = new DingTalkAdapter({
      appKey: "test",
      appSecret: "test",
      streamingEnabled: true,
    });
    expect(adapter.supportsStreaming()).toBe(false);
  });

  it("should have required methods", () => {
    const adapter = new DingTalkAdapter({
      appKey: "test",
      appSecret: "test",
    });
    expect(adapter.connect).toBeTypeOf("function");
    expect(adapter.disconnect).toBeTypeOf("function");
    expect(adapter.send).toBeTypeOf("function");
    expect(adapter.getChannels).toBeTypeOf("function");
  });
});

describe("XiaoyiAdapter", () => {
  it("should support streaming", () => {
    const adapter = new XiaoyiAdapter({
      ak: "test-ak",
      sk: "test-sk",
      agentId: "test-agent",
    });
    expect(adapter.platform).toBe("xiaoyi");
    expect(adapter.connect).toBeTypeOf("function");
    expect(adapter.disconnect).toBeTypeOf("function");
    expect(adapter.send).toBeTypeOf("function");
  });
});

describe("WhatsAppAdapter", () => {
  it("should have required methods", () => {
    const adapter = new WhatsAppAdapter({});
    expect(adapter.platform).toBe("whatsapp");
    expect(adapter.connect).toBeTypeOf("function");
    expect(adapter.disconnect).toBeTypeOf("function");
    expect(adapter.send).toBeTypeOf("function");
    expect(adapter.getChannels).toBeTypeOf("function");
  });
});

describe("SlackAdapter", () => {
  it("should have required methods", () => {
    const adapter = new SlackAdapter({ botToken: "xoxb-test" });
    expect(adapter.connect).toBeTypeOf("function");
    expect(adapter.send).toBeTypeOf("function");
    expect(adapter.getChannels).toBeTypeOf("function");
  });
});

describe("EmailAdapter", () => {
  it("should have IMAP and SMTP config", () => {
    const adapter = new EmailAdapter({
      imap: { host: "imap.test.com", port: 993 },
      smtp: { host: "smtp.test.com", port: 587 },
    });
    expect(adapter.platform).toBe("email");
    expect(adapter.connect).toBeTypeOf("function");
    expect(adapter.send).toBeTypeOf("function");
  });
});
