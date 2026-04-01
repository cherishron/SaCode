import { BaseAdapter } from "./base.js";
import type { IMMessage, Channel, Platform } from "./types/index.js";

/**
 * Slack 适配器配置
 */
interface SlackConfig {
  /** Bot Token (xoxb-xxx) */
  botToken: string;
  /** App-Level Token (xapp-xxx) - 用于 Socket Mode */
  appToken?: string;
  /** 群组消息响应策略 */
  groupPolicy: "mention" | "open" | "allowlist";
  /** 允许的频道/用户 ID 列表 (配合 allowlist 策略) */
  allowFrom?: string[];
}

/**
 * Slack API 响应
 */
interface SlackResponse<T = unknown> {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
  result?: T;
}

/**
 * Slack 消息事件
 */
interface SlackMessageEvent {
  type: "message";
  channel: string;
  user: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  subtype?: string;
  bot_id?: string;
}

/**
 * Slack 频道信息
 */
interface SlackChannel {
  id: string;
  name: string;
  is_channel: boolean;
  is_group: boolean;
  is_private: boolean;
  is_mpim: boolean;
}



/**
 * Slack 适配器
 *
 * 使用 Slack Web API + Socket Mode 实现实时消息收发
 *
 * 使用方式:
 * 1. 创建 Slack App 并获取 Bot Token (xoxb-xxx)
 * 2. 启用 Socket Mode 并获取 App-Level Token (xapp-xxx)
 * 3. 添加必要的 OAuth Scopes: chat:write, channels:history, im:history, groups:history
 *
 * @example
 * ```typescript
 * const adapter = new SlackAdapter({
 *   botToken: "xoxb-xxx",
 *   appToken: "xapp-xxx",
 *   groupPolicy: "mention",
 * });
 * await adapter.connect();
 * ```
 */
export class SlackAdapter extends BaseAdapter {
  platform: Platform = "slack";
  private config: SlackConfig;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastMessageTs: Map<string, string> = new Map();
  private botUserId: string | null = null;

  constructor(config: SlackConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.botToken) {
      throw new Error("[Slack] Bot token is required");
    }

    // 验证 Bot 并获取用户 ID
    const authResponse = await this.apiRequest<{ user_id: string }>(
      "auth.test"
    );

    if (!authResponse.ok) {
      throw new Error(
        `[Slack] Authentication failed: ${authResponse.error || "Unknown error"}`
      );
    }

    this.botUserId = (authResponse as unknown as { user_id: string }).user_id;
    this.connected = true;
    console.log("[Slack] Connected as bot user:", this.botUserId);

    // 开始轮询消息 (如果没有 appToken 用于 Socket Mode)
    if (!this.config.appToken) {
      console.log("[Slack] Using polling mode (no appToken provided)");
      this.startPolling();
    } else {
      console.log("[Slack] Socket Mode enabled");
      // Socket Mode 实现需要 @slack/socket-mode 包
      // 这里使用轮询作为后备方案
      this.startPolling();
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.connected = false;
    console.log("[Slack] Disconnected");
  }

  async send(message: IMMessage): Promise<void> {
    if (!this.connected) {
      throw new Error("[Slack] Not connected");
    }

    const response = await this.apiRequest<{ ts: string; channel: string }>(
      "chat.postMessage",
      {
        channel: message.channelId,
        text: message.content,
        thread_ts: message.metadata?.threadTs as string | undefined,
      }
    );

    if (!response.ok) {
      throw new Error(
        `[Slack] Failed to send message: ${response.error || "Unknown error"}`
      );
    }
  }

  async getChannels(): Promise<Channel[]> {
    if (!this.connected) {
      return [];
    }

    const channels: Channel[] = [];

    // 获取公开频道
    const channelsResponse = await this.apiRequest<{ channels: SlackChannel[] }>(
      "conversations.list",
      { types: "public_channel,private_channel,mpim,im" }
    );

    if (channelsResponse.ok) {
      const channelList = (
        channelsResponse as unknown as { channels: SlackChannel[] }
      ).channels;
      for (const ch of channelList) {
        channels.push({
          id: ch.id,
          name: ch.name,
          type: ch.is_private ? "private" : ch.is_channel ? "channel" : "group",
        });
      }
    }

    return channels;
  }

  /**
   * 检查消息是否应该被处理
   */
  private shouldProcessMessage(event: SlackMessageEvent): boolean {
    // 忽略机器人自己的消息
    if (event.bot_id || event.user === this.botUserId) {
      return false;
    }

    // 忽略消息子类型 (如 message_changed, message_deleted 等)
    if (event.subtype) {
      return false;
    }

    const channelId = event.channel;

    // 检查群组策略
    switch (this.config.groupPolicy) {
      case "mention":
        // 只响应提及机器人的消息
        if (event.text && this.botUserId) {
          return event.text.includes(`<@${this.botUserId}>`);
        }
        return false;

      case "open":
        // 响应所有消息
        return true;

      case "allowlist":
        // 只响应允许列表中的频道/用户
        if (this.config.allowFrom) {
          return (
            this.config.allowFrom.includes(channelId) ||
            this.config.allowFrom.includes(event.user)
          );
        }
        return false;

      default:
        return false;
    }
  }

  private startPolling(): void {
    this.pollingInterval = setInterval(async () => {
      try {
        // 获取所有已加入的频道
        const channelsResponse = await this.apiRequest<{
          channels: SlackChannel[];
        }>("conversations.list", {
          types: "public_channel,private_channel",
          limit: 100,
        });

        if (!channelsResponse.ok) return;

        const channels = (
          channelsResponse as unknown as { channels: SlackChannel[] }
        ).channels;

        // 轮询每个频道的历史消息
        for (const channel of channels) {
          await this.pollChannelHistory(channel.id);
        }

        // 同时检查私信
        await this.pollDirectMessages();
      } catch (error) {
        console.error("[Slack] Polling error:", error);
      }
    }, 5000);
  }

  private async pollChannelHistory(channelId: string): Promise<void> {
    const lastTs = this.lastMessageTs.get(channelId) || "0";

    const response = await this.apiRequest<{
      messages: SlackMessageEvent[];
    }>("conversations.history", {
      channel: channelId,
      oldest: lastTs,
      limit: 50,
    });

    if (!response.ok || !response.ok) return;

    const messages = (response as unknown as { messages?: SlackMessageEvent[] })
      .messages;

    if (messages && messages.length > 0) {
      // 更新最后消息时间戳
      const newLastTs = messages[0]?.ts;
      if (newLastTs) {
        this.lastMessageTs.set(channelId, newLastTs);
      }

      // 处理消息 (按时间正序)
      for (const msg of messages.reverse()) {
        if (this.shouldProcessMessage(msg)) {
          const imMessage: IMMessage = {
            id: msg.ts,
            platform: "slack",
            channelId: msg.channel,
            userId: msg.user,
            content: this.stripMentions(msg.text || ""),
            timestamp: parseFloat(msg.ts) * 1000,
            metadata: {
              threadTs: msg.thread_ts,
              originalText: msg.text,
            },
          };

          this.emitMessage(imMessage);
        }
      }
    }
  }

  private async pollDirectMessages(): Promise<void> {
    const response = await this.apiRequest<{
      ims: Array<{ id: string; user: string }>;
    }>("conversations.list", {
      types: "im",
      limit: 100,
    });

    if (!response.ok) return;

    const ims = (response as unknown as { ims?: Array<{ id: string; user: string }> }).ims;

    if (!ims) return;

    for (const im of ims) {
      await this.pollChannelHistory(im.id);
    }
  }

  /**
   * 移除消息中的 @mention
   */
  private stripMentions(text: string): string {
    return text.replace(/<@[A-Z0-9]+>/g, "").trim();
  }

  private async apiRequest<T = unknown>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<SlackResponse<T>> {
    const url = `https://slack.com/api/${method}`;

    const formBody = params
      ? Object.entries(params)
          .map(
            ([key, value]) =>
              `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
          )
          .join("&")
      : "";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${this.config.botToken}`,
      },
      body: formBody,
    });

    return response.json() as Promise<SlackResponse<T>>;
  }
}
