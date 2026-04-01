import { BaseAdapter } from "./base.js";
import type { IMMessage, IMMediaMessage, Channel, Platform, MessageContent } from "./types/index.js";

interface DiscordConfig {
  botToken: string;
}

interface DiscordGatewayResponse {
  url: string;
}

interface DiscordAttachment {
  id: string;
  filename: string;
  url: string;
  proxy_url: string;
  size: number;
  height?: number;
  width?: number;
  content_type?: string;
}

interface DiscordMessageData {
  id: string;
  channel_id: string;
  guild_id?: string;
  author?: {
    id: string;
    username: string;
  };
  content: string;
  attachments?: DiscordAttachment[];
  timestamp: string;
}

/**
 * Discord 适配器
 * 
 * 支持：
 * - Gateway WebSocket 连接
 * - 多媒体消息：图片、语音、视频、文件
 * - Embed 消息
 */
export class DiscordAdapter extends BaseAdapter {
  platform: Platform = "discord";
  private config: DiscordConfig;
  private gateway: WebSocket | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private seq: number | null = null;

  constructor(config: DiscordConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.botToken) {
      throw new Error("Bot token is required");
    }

    // 获取 Gateway URL
    const gatewayResponse = await fetch(
      "https://discord.com/api/v10/gateway/bot",
      {
        headers: {
          Authorization: `Bot ${this.config.botToken}`,
        },
      }
    );

    const gatewayData = (await gatewayResponse.json()) as DiscordGatewayResponse;
    await this.connectGateway(gatewayData.url);
  }

  private async connectGateway(gatewayUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.gateway = new WebSocket(`${gatewayUrl}?v=10&encoding=json`);

      this.gateway.onopen = () => {
        console.log("[Discord] Gateway connected");
      };

      this.gateway.onmessage = (event) => {
        this.handleGatewayMessage(event.data, resolve, reject);
      };

      this.gateway.onerror = (error) => {
        console.error("[Discord] Gateway error:", error);
        reject(error);
      };

      this.gateway.onclose = () => {
        console.log("[Discord] Gateway closed");
        this.connected = false;
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
        }
      };
    });
  }

  private handleGatewayMessage(
    data: string,
    resolve: () => void,
    _reject: (error: Error) => void
  ): void {
    const payload = JSON.parse(data);
    const { op, d, s, t } = payload;

    this.seq = s;

    switch (op) {
      case 10: // Hello
        // Start heartbeat
        this.heartbeatInterval = setInterval(() => {
          this.gateway?.send(JSON.stringify({ op: 1, d: this.seq }));
        }, d.heartbeat_interval);

        // Send identify
        this.gateway?.send(
          JSON.stringify({
            op: 2,
            d: {
              token: this.config.botToken,
              intents: 513, // Guilds + GuildMessages + DirectMessages
              properties: {
                os: "linux",
                browser: "SACODE",
                device: "SACODE",
              },
            },
          })
        );
        break;

      case 11: // Heartbeat ACK
        break;

      case 0: // Dispatch
        if (t === "READY") {
          this.connected = true;
          console.log("[Discord] Ready:", d.user.username);
          resolve();
        } else if (t === "MESSAGE_CREATE") {
          this.handleMessageCreate(d);
        }
        break;
    }
  }

  private handleMessageCreate(data: DiscordMessageData): void {
    const contents: MessageContent[] = [];

    // 文本内容
    if (data.content) {
      contents.push({ type: "text", text: data.content });
    }

    // 解析附件
    if (data.attachments && data.attachments.length > 0) {
      for (const attachment of data.attachments) {
        const contentType = attachment.content_type || "";

        if (contentType.startsWith("image/")) {
          contents.push({
            type: "image",
            url: attachment.url,
            width: attachment.width,
            height: attachment.height,
            size: attachment.size,
            mimeType: contentType,
          });
        } else if (contentType.startsWith("audio/")) {
          contents.push({
            type: "audio",
            url: attachment.url,
            size: attachment.size,
            mimeType: contentType,
            filename: attachment.filename,
          });
        } else if (contentType.startsWith("video/")) {
          contents.push({
            type: "video",
            url: attachment.url,
            width: attachment.width,
            height: attachment.height,
            size: attachment.size,
            mimeType: contentType,
          });
        } else {
          contents.push({
            type: "file",
            url: attachment.url,
            filename: attachment.filename,
            size: attachment.size,
            mimeType: contentType,
          });
        }
      }
    }

    const message: IMMessage = {
      id: data.id,
      platform: "discord",
      channelId: data.channel_id,
      userId: data.author?.id || "unknown",
      content: data.content || "",
      contents: contents.length > 0 ? contents : undefined,
      timestamp: Date.now(),
      metadata: {
        guildId: data.guild_id,
        username: data.author?.username,
      },
    };

    this.emitMessage(message);
  }

  async disconnect(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.gateway) {
      this.gateway.close();
      this.gateway = null;
    }
    this.connected = false;
  }

  async send(message: IMMessage): Promise<void> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    // 检查是否有多媒体内容
    if (message.contents && message.contents.length > 0) {
      await this.sendMedia(message as IMMediaMessage);
      return;
    }

    // 发送纯文本消息
    await this.sendTextMessage(message.channelId, message.content);
  }

  async getChannels(): Promise<Channel[]> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    const channels: Channel[] = [];

    try {
      // Get guilds (servers)
      const guildsResponse = await fetch(
        "https://discord.com/api/v10/users/@me/guilds",
        {
          headers: {
            Authorization: `Bot ${this.config.botToken}`,
          },
        }
      );

      const guilds = (await guildsResponse.json()) as Array<{
        id: string;
        name: string;
      }>;

      // Get channels for each guild
      for (const guild of guilds) {
        try {
          const channelsResponse = await fetch(
            `https://discord.com/api/v10/guilds/${guild.id}/channels`,
            {
              headers: {
                Authorization: `Bot ${this.config.botToken}`,
              },
            }
          );

          const guildChannels = (await channelsResponse.json()) as Array<{
            id: string;
            name: string;
            type: number;
          }>;

          // Filter text channels (type 0=text, 5=announcement) and skip categories (type 4)
          for (const channel of guildChannels) {
            if (channel.type === 0 || channel.type === 5) {
              channels.push({
                id: channel.id,
                name: `${guild.name} > ${channel.name}`,
                type: channel.type === 5 ? "channel" : "group",
              });
            }
          }
        } catch {
          // Skip guild if channels fetch fails
        }
      }

      return channels;
    } catch (error) {
      throw new Error(`Failed to get channels: ${error}`);
    }
  }

  // ============================================
  // 多媒体支持
  // ============================================

  override supportsImage(): boolean {
    return true;
  }

  override supportsAudio(): boolean {
    return true;
  }

  override supportsVideo(): boolean {
    return true;
  }

  override supportsFile(): boolean {
    return true;
  }

  /**
   * 发送多媒体消息
   */
  override async sendMedia(message: IMMediaMessage): Promise<string | undefined> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    // Discord 支持在一条消息中发送多个附件
    const textContent = message.contents.find((c) => c.type === "text");
    const mediaContents = message.contents.filter((c) => c.type !== "text");

    // 准备附件
    const attachments: Array<{
      id: number;
      description?: string | undefined;
      filename: string;
    }> = [];

    const embeds: Array<{
      image?: { url: string } | undefined;
      video?: { url: string } | undefined;
    }> = [];

    for (let i = 0; i < mediaContents.length; i++) {
      const content = mediaContents[i];
      if (!content) continue;

      if (content.type === "image") {
        // 图片可以通过 embed 或附件发送
        const imageUrl = content.url;
        if (imageUrl) {
          embeds.push({ image: { url: imageUrl } });
        }
      } else if (content.type === "video") {
        const videoUrl = content.url;
        if (videoUrl) {
          embeds.push({ video: { url: videoUrl } });
        }
      } else if (content.type === "audio") {
        attachments.push({
          id: i,
          filename: content.filename || "audio",
          description: content.transcription,
        });
      } else if (content.type === "file") {
        attachments.push({
          id: i,
          filename: content.filename,
        });
      }
    }

    // 构建消息体
    const body: Record<string, unknown> = {
      content: textContent && textContent.type === "text" ? textContent.text : message.content,
    };

    if (embeds.length > 0) {
      body.embeds = embeds;
    }

    // 发送消息
    const response = await fetch(
      `https://discord.com/api/v10/channels/${message.channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.config.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (response.ok) {
      const result = await response.json() as { id: string };
      return result.id;
    }

    return undefined;
  }

  /**
   * 发送文本消息
   */
  private async sendTextMessage(channelId: string, content: string): Promise<void> {
    await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.config.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      }
    );
  }
}
