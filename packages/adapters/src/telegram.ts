import { BaseAdapter } from "./base.js";
import type { IMMessage, IMMediaMessage, Channel, Platform, MessageContent, ImageContent, AudioContent, VideoContent, FileContent } from "./types/index.js";

interface TelegramConfig {
  botToken: string;
  apiBaseUrl?: string;
  /** 是否启用流式输出 */
  streamingEnabled?: boolean;
  /** 解析模式 */
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
}

interface TelegramUser {
  id: number;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: { id: number; username?: string };
  text?: string;
  date: number;
  photo?: Array<{ file_id: string; width: number; height: number }>;
  audio?: { file_id: string; duration: number; title?: string };
  voice?: { file_id: string; duration: number };
  video?: { file_id: string; duration: number; width: number; height: number };
  video_note?: { file_id: string; duration: number };
  document?: { file_id: string; file_name?: string; mime_type?: string };
  caption?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramResponse<T = unknown> {
  ok: boolean;
  result: T;
  description?: string;
}

/**
 * Telegram 适配器
 * 
 * 支持：
 * - 流式输出：通过 editMessageText API 实时编辑消息
 * - 多媒体消息：图片、语音、视频、文件
 */
export class TelegramAdapter extends BaseAdapter {
  platform: Platform = "telegram";
  private config: TelegramConfig;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastUpdateId = 0;

  constructor(config: TelegramConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.botToken) {
      throw new Error("Bot token is required");
    }

    // 验证 bot
    const response = await this.apiRequest<TelegramUser>("getMe");
    if (!response.ok) {
      throw new Error("Failed to verify bot");
    }

    this.connected = true;
    const user = response.result as TelegramUser;
    console.log("[Telegram] Connected:", user.username);

    // 开始轮询
    this.startPolling();
  }

  async disconnect(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
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
    await this.apiRequest("sendMessage", {
      chat_id: message.channelId,
      text: message.content,
      parse_mode: this.config.parseMode,
    });
  }

  async getChannels(): Promise<Channel[]> {
    // Telegram 需要 chat_id，无法主动获取
    return [];
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

  override supportsLocation(): boolean {
    return true;
  }

  override supportsSticker(): boolean {
    return true;
  }

  /**
   * 发送多媒体消息
   */
  override async sendMedia(message: IMMediaMessage): Promise<string | undefined> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    let lastMessageId: string | undefined;

    for (const content of message.contents) {
      const msgId = await this.sendContent(message.channelId, content);
      if (msgId) {
        lastMessageId = msgId;
      }
    }

    // 如果有文本但没有发送，单独发送
    const textContent = message.contents.find((c) => c.type === "text");
    if (textContent && textContent.type === "text" && textContent.text) {
      // 文本已在 sendContent 中处理
    } else if (message.content && !textContent) {
      const response = await this.apiRequest<TelegramMessage>("sendMessage", {
        chat_id: message.channelId,
        text: message.content,
        parse_mode: this.config.parseMode,
      });
      if (response.ok && response.result) {
        lastMessageId = response.result.message_id.toString();
      }
    }

    return lastMessageId;
  }

  /**
   * 发送单个内容
   */
  private async sendContent(channelId: string, content: MessageContent): Promise<string | undefined> {
    switch (content.type) {
      case "text":
        return this.sendText(channelId, content.text);
      case "image":
        return this.sendImage(channelId, content);
      case "audio":
        return this.sendAudio(channelId, content);
      case "video":
        return this.sendVideo(channelId, content);
      case "file":
        return this.sendFile(channelId, content);
      case "location":
        return this.sendLocation(channelId, content.latitude, content.longitude, content.name, content.address);
      case "sticker":
        return this.sendSticker(channelId, content.stickerId);
      default:
        return undefined;
    }
  }

  /**
   * 发送文本
   */
  private async sendText(channelId: string, text: string): Promise<string | undefined> {
    const response = await this.apiRequest<TelegramMessage>("sendMessage", {
      chat_id: channelId,
      text,
      parse_mode: this.config.parseMode,
    });

    if (response.ok && response.result) {
      return response.result.message_id.toString();
    }
    return undefined;
  }

  /**
   * 发送图片
   */
  private async sendImage(channelId: string, content: ImageContent): Promise<string | undefined> {
    const params: Record<string, unknown> = {
      chat_id: channelId,
      caption: content.caption,
      parse_mode: this.config.parseMode,
    };

    // 优先使用 URL，其次 base64
    if (content.url) {
      params.photo = content.url;
    } else if (content.base64) {
      // Telegram 不支持直接发送 base64，需要先上传
      // 这里简化处理，假设 URL 已提供
      console.warn("[Telegram] Base64 image upload not implemented, please provide URL");
      return undefined;
    } else if (content.path) {
      console.warn("[Telegram] Local file upload not implemented, please provide URL");
      return undefined;
    }

    const response = await this.apiRequest<TelegramMessage>("sendPhoto", params);

    if (response.ok && response.result) {
      return response.result.message_id.toString();
    }

    console.error("[Telegram] Failed to send image:", response.description);
    return undefined;
  }

  /**
   * 发送语音
   */
  private async sendAudio(channelId: string, content: AudioContent): Promise<string | undefined> {
    const params: Record<string, unknown> = {
      chat_id: channelId,
      caption: content.transcription || content.filename,
      parse_mode: this.config.parseMode,
    };

    if (content.url) {
      // 判断是语音消息还是音频文件
      if (content.mimeType?.startsWith("audio/ogg") || content.duration) {
        params.voice = content.url;
        const response = await this.apiRequest<TelegramMessage>("sendVoice", params);
        if (response.ok && response.result) {
          return response.result.message_id.toString();
        }
      }

      params.audio = content.url;
      if (content.duration) {
        params.duration = content.duration;
      }
      if (content.filename) {
        params.title = content.filename;
      }

      const response = await this.apiRequest<TelegramMessage>("sendAudio", params);

      if (response.ok && response.result) {
        return response.result.message_id.toString();
      }
    }

    return undefined;
  }

  /**
   * 发送视频
   */
  private async sendVideo(channelId: string, content: VideoContent): Promise<string | undefined> {
    const params: Record<string, unknown> = {
      chat_id: channelId,
      caption: content.caption,
      parse_mode: this.config.parseMode,
    };

    if (content.url) {
      params.video = content.url;
    }

    if (content.duration) {
      params.duration = content.duration;
    }

    if (content.width && content.height) {
      params.width = content.width;
      params.height = content.height;
    }

    if (content.thumbnailUrl) {
      params.thumbnail = content.thumbnailUrl;
    }

    const response = await this.apiRequest<TelegramMessage>("sendVideo", params);

    if (response.ok && response.result) {
      return response.result.message_id.toString();
    }

    return undefined;
  }

  /**
   * 发送文件
   */
  private async sendFile(channelId: string, content: FileContent): Promise<string | undefined> {
    const params: Record<string, unknown> = {
      chat_id: channelId,
    };

    if (content.url) {
      params.document = content.url;
    }

    if (content.filename) {
      // Note: Telegram doesn't support renaming via API
      // The filename comes from the URL or uploaded file
    }

    const response = await this.apiRequest<TelegramMessage>("sendDocument", params);

    if (response.ok && response.result) {
      return response.result.message_id.toString();
    }

    return undefined;
  }

  /**
   * 发送位置
   */
  private async sendLocation(
    channelId: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string
  ): Promise<string | undefined> {
    const params: Record<string, unknown> = {
      chat_id: channelId,
      latitude,
      longitude,
    };

    if (name || address) {
      // 使用 sendVenue 发送带名称的位置
      params.title = name;
      params.address = address || "";

      const response = await this.apiRequest<TelegramMessage>("sendVenue", params);
      if (response.ok && response.result) {
        return response.result.message_id.toString();
      }
    } else {
      const response = await this.apiRequest<TelegramMessage>("sendLocation", params);
      if (response.ok && response.result) {
        return response.result.message_id.toString();
      }
    }

    return undefined;
  }

  /**
   * 发送表情包
   */
  private async sendSticker(channelId: string, stickerId: string): Promise<string | undefined> {
    const response = await this.apiRequest<TelegramMessage>("sendSticker", {
      chat_id: channelId,
      sticker: stickerId,
    });

    if (response.ok && response.result) {
      return response.result.message_id.toString();
    }

    return undefined;
  }

  // ============================================
  // 流式输出支持
  // ============================================

  override supportsStreaming(): boolean {
    return this.config.streamingEnabled !== false;
  }

  override async sendInitial(channelId: string, text: string): Promise<string | undefined> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    const response = await this.apiRequest<TelegramMessage>("sendMessage", {
      chat_id: channelId,
      text: text || "...",
      parse_mode: this.config.parseMode,
    });

    if (response.ok && response.result) {
      return response.result.message_id.toString();
    }

    console.error("[Telegram] Failed to send initial message:", response.description);
    return undefined;
  }

  override async editMessage(channelId: string, messageId: string, text: string): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.apiRequest("editMessageText", {
        chat_id: channelId,
        message_id: parseInt(messageId, 10),
        text: text || "...",
        parse_mode: this.config.parseMode,
      });
    } catch (error) {
      console.error("[Telegram] Edit message error:", error);
    }
  }

  // ============================================
  // 消息轮询
  // ============================================

  private startPolling(): void {
    this.pollingInterval = setInterval(async () => {
      try {
        const response = await this.apiRequest<TelegramUpdate[]>("getUpdates", {
          offset: this.lastUpdateId + 1,
          timeout: 0,
        });

        if (response.ok && response.result.length > 0) {
          for (const update of response.result) {
            this.lastUpdateId = update.update_id;

            if (update.message) {
              const message = this.parseMessage(update.message);
              this.emitMessage(message);
            }
          }
        }
      } catch (error) {
        console.error("[Telegram] Polling error:", error);
      }
    }, 1000);
  }

  /**
   * 解析 Telegram 消息为 IMMessage
   */
  private parseMessage(msg: TelegramMessage): IMMessage {
    const contents: MessageContent[] = [];

    // 文本内容
    if (msg.text) {
      contents.push({ type: "text", text: msg.text });
    }

    // 图片内容
    if (msg.photo && msg.photo.length > 0) {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      if (largestPhoto) {
        const imageContent: ImageContent = {
          type: "image",
          url: largestPhoto.file_id,
          width: largestPhoto.width,
          height: largestPhoto.height,
        };
        if (msg.caption) {
          imageContent.caption = msg.caption;
        }
        contents.push(imageContent);
      }
    }

    // 语音内容
    if (msg.voice) {
      contents.push({
        type: "audio",
        url: msg.voice.file_id,
        duration: msg.voice.duration,
        mimeType: "audio/ogg",
      });
    }

    // 音频内容
    if (msg.audio) {
      const audioContent: AudioContent = {
        type: "audio",
        url: msg.audio.file_id,
        duration: msg.audio.duration,
      };
      if (msg.audio.title) {
        audioContent.filename = msg.audio.title;
      }
      contents.push(audioContent);
    }

    // 视频内容
    if (msg.video) {
      const videoContent: VideoContent = {
        type: "video",
        url: msg.video.file_id,
        duration: msg.video.duration,
        width: msg.video.width,
        height: msg.video.height,
      };
      if (msg.caption) {
        videoContent.caption = msg.caption;
      }
      contents.push(videoContent);
    }

    // 文件内容
    if (msg.document) {
      const fileContent: FileContent = {
        type: "file",
        filename: msg.document.file_name || "document",
        url: msg.document.file_id,
      };
      if (msg.document.mime_type) {
        fileContent.mimeType = msg.document.mime_type;
      }
      contents.push(fileContent);
    }

    return {
      id: msg.message_id.toString(),
      platform: "telegram",
      channelId: msg.chat.id.toString(),
      userId: msg.from?.id.toString() || "unknown",
      content: msg.text || msg.caption || "",
      contents: contents.length > 0 ? contents : undefined,
      timestamp: msg.date * 1000,
      metadata: {
        chatType: msg.chat.type,
        username: msg.from?.username,
      },
    };
  }

  private async apiRequest<T = unknown>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<TelegramResponse<T>> {
    const baseUrl =
      this.config.apiBaseUrl || "https://api.telegram.org";
    const url = `${baseUrl}/bot${this.config.botToken}/${method}`;

    const fetchOptions: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    };

    if (params) {
      fetchOptions.body = JSON.stringify(params);
    }

    const response = await fetch(url, fetchOptions);
    return response.json() as Promise<TelegramResponse<T>>;
  }
}
