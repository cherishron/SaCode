/**
 * @sacode/types - Adapter Types Unit Tests
 */

import { describe, it, expect } from "vitest";
import {
  type Platform,
  type IMConfig,
  type Channel,
  type ChannelType,
  type IMMessage,
  type IMMediaMessage,
  type IMAdapter,
  type SendOptions,
  type StreamOptions,
} from "../adapter.js";
import { type MessageContent } from "../message.js";

describe("Adapter Types", () => {
  describe("Platform", () => {
    it("should support all 10 platforms", () => {
      const platforms: Platform[] = [
        "wechat",
        "qq",
        "telegram",
        "discord",
        "dingtalk",
        "feishu",
        "xiaoyi",
        "whatsapp",
        "slack",
        "email",
      ];

      expect(platforms).toHaveLength(10);
    });
  });

  describe("IMConfig", () => {
    it("should create valid IMConfig for telegram", () => {
      const config: IMConfig = {
        platform: "telegram",
        config: { botToken: "test-token" },
      };

      expect(config.platform).toBe("telegram");
      expect(config.config.botToken).toBe("test-token");
    });

    it("should create valid IMConfig for wechat", () => {
      const config: IMConfig = {
        platform: "wechat",
        config: { appId: "wx123", appSecret: "secret" },
      };

      expect(config.platform).toBe("wechat");
      expect(config.config.appId).toBe("wx123");
    });
  });

  describe("Channel", () => {
    it("should create valid private channel", () => {
      const channel: Channel = {
        id: "user_123",
        name: "John Doe",
        type: "private",
      };

      expect(channel.id).toBe("user_123");
      expect(channel.type).toBe("private");
      expect(channel.metadata).toBeUndefined();
    });

    it("should create valid group channel with metadata", () => {
      const channel: Channel = {
        id: "group_456",
        name: "Development Team",
        type: "group",
        metadata: { memberCount: 50 },
      };

      expect(channel.type).toBe("group");
      expect(channel.metadata?.memberCount).toBe(50);
    });

    it("should create valid channel type", () => {
      const types: ChannelType[] = ["private", "group", "channel"];
      expect(types).toHaveLength(3);
    });
  });

  describe("IMMessage", () => {
    it("should create valid text message", () => {
      const message: IMMessage = {
        id: "msg_001",
        platform: "telegram",
        channelId: "chat_123",
        userId: "user_456",
        content: "Hello, world!",
        timestamp: Date.now(),
      };

      expect(message.id).toBe("msg_001");
      expect(message.platform).toBe("telegram");
      expect(message.contents).toBeUndefined();
      expect(message.replyTo).toBeUndefined();
      expect(message.metadata).toBeUndefined();
    });

    it("should create valid message with optional fields", () => {
      const message: IMMessage = {
        id: "msg_002",
        platform: "discord",
        channelId: "channel_789",
        userId: "user_012",
        content: "Reply message",
        timestamp: Date.now(),
        replyTo: "msg_001",
        metadata: { edited: false },
      };

      expect(message.replyTo).toBe("msg_001");
      expect(message.metadata?.edited).toBe(false);
    });

    it("should create valid media message", () => {
      const textContent: MessageContent = { type: "text", text: "Check this image" };
      const imageContent: MessageContent = {
        type: "image",
        url: "https://example.com/image.png",
      };

      const message: IMMediaMessage = {
        id: "msg_003",
        platform: "wechat",
        channelId: "chat_456",
        userId: "user_789",
        content: "Image message",
        contents: [textContent, imageContent],
        timestamp: Date.now(),
      };

      expect(message.contents).toHaveLength(2);
      expect(message.contents[0].type).toBe("text");
      expect(message.contents[1].type).toBe("image");
    });
  });

  describe("SendOptions", () => {
    it("should create empty send options", () => {
      const options: SendOptions = {};

      expect(options.replyTo).toBeUndefined();
      expect(options.parseMarkdown).toBeUndefined();
      expect(options.silent).toBeUndefined();
    });

    it("should create valid send options with all fields", () => {
      const options: SendOptions = {
        replyTo: "msg_001",
        parseMarkdown: true,
        silent: false,
      };

      expect(options.replyTo).toBe("msg_001");
      expect(options.parseMarkdown).toBe(true);
      expect(options.silent).toBe(false);
    });
  });

  describe("StreamOptions", () => {
    it("should extend SendOptions", () => {
      const options: StreamOptions = {
        replyTo: "msg_001",
        parseMarkdown: true,
        silent: false,
        initialMessage: "Thinking...",
        updateInterval: 100,
      };

      expect(options.initialMessage).toBe("Thinking...");
      expect(options.updateInterval).toBe(100);
      expect(options.replyTo).toBe("msg_001");
    });

    it("should allow undefined stream-specific fields", () => {
      const options: StreamOptions = {
        parseMarkdown: true,
      };

      expect(options.initialMessage).toBeUndefined();
      expect(options.updateInterval).toBeUndefined();
    });
  });

  describe("IMAdapter Interface", () => {
    it("should implement IMAdapter interface correctly", async () => {
      const adapter: IMAdapter = {
        platform: "telegram",
        connect: async () => {},
        disconnect: async () => {},
        send: async (_message: IMMessage) => {},
        onMessage: (_callback: (message: IMMessage) => void) => {},
        isConnected: () => true,
        getChannels: async () => [{ id: "1", name: "Test", type: "private" }],
      };

      expect(adapter.platform).toBe("telegram");
      expect(adapter.isConnected()).toBe(true);
      expect(await adapter.getChannels()).toHaveLength(1);
    });

    it("should support all platform types in adapter", () => {
      const platforms: Platform[] = [
        "wechat",
        "qq",
        "telegram",
        "discord",
        "dingtalk",
        "feishu",
        "xiaoyi",
        "whatsapp",
        "slack",
        "email",
      ];

      platforms.forEach((platform) => {
        const adapter: IMAdapter = {
          platform,
          connect: async () => {},
          disconnect: async () => {},
          send: async () => {},
          onMessage: () => {},
          isConnected: () => false,
          getChannels: async () => [],
        };

        expect(adapter.platform).toBe(platform);
      });
    });
  });
});
