import { BaseAdapter } from "./base.js";
import type { IMMessage, IMMediaMessage, Channel, Platform } from "./types/index.js";

// ============================================
// 类型定义
// ============================================

/**
 * WhatsApp 适配器配置
 * 使用 baileys 桥接服务连接 WhatsApp Web 协议
 */
interface WhatsAppConfig {
  /** baileys 桥接服务地址 */
  bridgeUrl: string;
  /** 认证 Token (可选) */
  bridgeToken?: string;
  /** 会话 ID (用于多会话支持) */
  sessionId?: string;
  /** 是否启用 WebSocket 实时连接 */
  useWebSocket?: boolean;
  /** 轮询间隔 (毫秒，默认 2000) */
  pollingInterval?: number;
  /** 重连延迟 (毫秒) */
  reconnectDelay?: number;
  /** 超时 (毫秒) */
  timeout?: number;
}

/**
 * baileys 桥接服务消息格式
 */
interface BridgeMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
  type: "text" | "image" | "video" | "audio" | "document" | "location" | "contact";
  metadata?: {
    pushName?: string;
    isGroup?: boolean;
    participant?: string;
    mimeType?: string;
    fileName?: string;
    caption?: string;
    latitude?: number;
    longitude?: number;
  };
  media?: {
    url?: string;
    base64?: string;
  };
}

/**
 * baileys 桥接服务响应
 */
interface BridgeResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * 多媒体消息配置
 */
interface MediaConfig {
  type: "image" | "video" | "audio" | "document";
  url?: string | undefined;
  base64?: string | undefined;
  caption?: string | undefined;
  fileName?: string | undefined;
  mimeType?: string | undefined;
}

/**
 * 位置消息配置
 */
interface LocationConfig {
  latitude: number;
  longitude: number;
  name?: string | undefined;
  address?: string | undefined;
}

/**
 * 联系人消息配置
 */
interface ContactConfig {
  displayName: string;
  phoneNumber: string;
}

/**
 * WhatsApp 适配器
 *
 * 通过 baileys 桥接服务实现 WhatsApp 消息收发
 * 支持文本、多媒体、位置、联系人消息
 *
 * 使用方式:
 * 1. 部署 baileys 桥接服务 (如 whatsapp-web.js 或自建服务)
 * 2. 配置 bridgeUrl 指向桥接服务地址
 * 3. 可选配置 bridgeToken 进行认证
 *
 * @example
 * ```typescript
 * const adapter = new WhatsAppAdapter({
 *   bridgeUrl: "http://localhost:3001",
 *   bridgeToken: "your-token",
 * });
 * await adapter.connect();
 * ```
 */
export class WhatsAppAdapter extends BaseAdapter {
  platform: Platform = "whatsapp";
  private config: Required<
    Pick<WhatsAppConfig, "bridgeUrl">
  > &
    WhatsAppConfig;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private webSocket: WebSocket | null = null;
  private messageQueue: BridgeMessage[] = [];
  private isReconnecting = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: WhatsAppConfig) {
    super();
    this.config = {
      pollingInterval: 2000,
      reconnectDelay: 5000,
      timeout: 30000,
      useWebSocket: false,
      ...config,
    };
  }

  async connect(): Promise<void> {
    if (!this.config.bridgeUrl) {
      throw new Error("[WhatsApp] Bridge URL is required");
    }

    // 验证桥接服务连接
    try {
      const response = await this.bridgeRequest<{ status: string }>(
        "GET",
        "/status"
      );

      if (!response.success || response.data?.status !== "connected") {
        throw new Error("[WhatsApp] Bridge service not ready");
      }

      this.connected = true;
      console.log("[WhatsApp] Connected to bridge service");

      // 选择连接方式
      if (this.config.useWebSocket) {
        await this.connectWebSocket();
      } else {
        this.startPolling();
      }
    } catch (error) {
      throw new Error(
        `[WhatsApp] Failed to connect: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async disconnect(): Promise<void> {
    this.stopPolling();
    this.disconnectWebSocket();
    this.clearReconnectTimer();
    this.connected = false;
    console.log("[WhatsApp] Disconnected");
  }

  async send(message: IMMessage): Promise<void> {
    if (!this.connected) {
      throw new Error("[WhatsApp] Not connected");
    }

    // WhatsApp 号码格式: 不需要 @s.whatsapp.net 后缀，桥接服务会处理
    const response = await this.bridgeRequest<{ messageId: string }>(
      "POST",
      "/send",
      {
        to: message.channelId,
        content: message.content,
        type: "text",
        sessionId: this.config.sessionId,
      }
    );

    if (!response.success) {
      throw new Error(
        `[WhatsApp] Failed to send message: ${response.error || "Unknown error"}`
      );
    }
  }

  async getChannels(): Promise<Channel[]> {
    if (!this.connected) {
      return [];
    }

    const response = await this.bridgeRequest<
      Array<{ id: string; name: string; isGroup: boolean }>
    >("GET", "/chats");

    if (!response.success || !response.data) {
      return [];
    }

    return response.data.map((chat) => ({
      id: chat.id,
      name: chat.name || chat.id,
      type: chat.isGroup ? "group" : "private",
    }));
  }

  // ============================================
  // 多媒体消息支持
  // ============================================

  /**
   * 发送多媒体消息 (实现基类接口)
   */
  override async sendMedia(message: IMMediaMessage): Promise<string | undefined> {
    if (!this.connected) {
      throw new Error("[WhatsApp] Not connected");
    }

    // 处理多媒体内容
    for (const content of message.contents) {
      if (content.type === "image") {
        const config: MediaConfig = {
          type: "image",
          url: content.url,
          base64: content.base64,
          caption: content.caption,
        };
        return this.sendMediaByConfig(message.channelId, config);
      } else if (content.type === "video") {
        const config: MediaConfig = {
          type: "video",
          url: content.url,
          base64: content.base64,
          caption: content.caption,
        };
        return this.sendMediaByConfig(message.channelId, config);
      } else if (content.type === "audio") {
        const config: MediaConfig = {
          type: "audio",
          url: content.url,
          base64: content.base64,
          mimeType: content.mimeType,
        };
        return this.sendMediaByConfig(message.channelId, config);
      } else if (content.type === "file") {
        const config: MediaConfig = {
          type: "document",
          url: content.url,
          base64: content.base64,
          fileName: content.filename,
          mimeType: content.mimeType,
        };
        return this.sendMediaByConfig(message.channelId, config);
      }
    }

    // 如果没有多媒体内容，发送文本
    await this.send(message);
    return undefined;
  }

  /**
   * 通过配置发送多媒体消息
   */
  async sendMediaByConfig(channelId: string, media: MediaConfig): Promise<string> {
    if (!this.connected) {
      throw new Error("[WhatsApp] Not connected");
    }

    const response = await this.bridgeRequest<{ messageId: string }>(
      "POST",
      "/send/media",
      {
        to: channelId,
        type: media.type,
        url: media.url,
        base64: media.base64,
        caption: media.caption,
        fileName: media.fileName,
        mimeType: media.mimeType,
        sessionId: this.config.sessionId,
      }
    );

    if (!response.success) {
      throw new Error(
        `[WhatsApp] Failed to send media: ${response.error || "Unknown error"}`
      );
    }

    return response.data?.messageId || "";
  }

  /**
   * 发送图片
   */
  async sendImage(
    channelId: string,
    source: { url?: string; base64?: string },
    caption?: string
  ): Promise<string> {
    const config: MediaConfig = {
      type: "image",
      ...source,
    };
    if (caption) {
      config.caption = caption;
    }
    return this.sendMediaByConfig(channelId, config);
  }

  /**
   * 发送视频
   */
  async sendVideo(
    channelId: string,
    source: { url?: string; base64?: string },
    caption?: string
  ): Promise<string> {
    const config: MediaConfig = {
      type: "video",
      ...source,
    };
    if (caption) {
      config.caption = caption;
    }
    return this.sendMediaByConfig(channelId, config);
  }

  /**
   * 发送音频
   */
  async sendAudio(
    channelId: string,
    source: { url?: string; base64?: string }
  ): Promise<string> {
    return this.sendMediaByConfig(channelId, {
      type: "audio",
      ...source,
    });
  }

  /**
   * 发送文档
   */
  async sendDocument(
    channelId: string,
    source: { url?: string; base64?: string },
    fileName: string,
    caption?: string
  ): Promise<string> {
    const config: MediaConfig = {
      type: "document",
      ...source,
      fileName,
    };
    if (caption) {
      config.caption = caption;
    }
    return this.sendMediaByConfig(channelId, config);
  }

  /**
   * 发送位置
   */
  async sendLocation(channelId: string, location: LocationConfig): Promise<string> {
    if (!this.connected) {
      throw new Error("[WhatsApp] Not connected");
    }

    const response = await this.bridgeRequest<{ messageId: string }>(
      "POST",
      "/send/location",
      {
        to: channelId,
        latitude: location.latitude,
        longitude: location.longitude,
        name: location.name,
        address: location.address,
        sessionId: this.config.sessionId,
      }
    );

    if (!response.success) {
      throw new Error(
        `[WhatsApp] Failed to send location: ${response.error || "Unknown error"}`
      );
    }

    return response.data?.messageId || "";
  }

  /**
   * 发送联系人
   */
  async sendContact(channelId: string, contact: ContactConfig): Promise<string> {
    if (!this.connected) {
      throw new Error("[WhatsApp] Not connected");
    }

    const response = await this.bridgeRequest<{ messageId: string }>(
      "POST",
      "/send/contact",
      {
        to: channelId,
        displayName: contact.displayName,
        phoneNumber: contact.phoneNumber,
        sessionId: this.config.sessionId,
      }
    );

    if (!response.success) {
      throw new Error(
        `[WhatsApp] Failed to send contact: ${response.error || "Unknown error"}`
      );
    }

    return response.data?.messageId || "";
  }

  // ============================================
  // 流式输出支持
  // ============================================

  /**
   * 是否支持流式输出
   */
  override supportsStreaming(): boolean {
    return true;
  }

  /**
   * 发送初始消息 (流式开始)
   * WhatsApp 通过桥接服务支持流式编辑
   */
  override async sendInitial(
    channelId: string,
    text: string
  ): Promise<string | undefined> {
    if (!this.connected) {
      return undefined;
    }

    try {
      const response = await this.bridgeRequest<{ messageId: string }>(
        "POST",
        "/stream/start",
        {
          to: channelId,
          content: text,
          sessionId: this.config.sessionId,
        }
      );

      if (response.success && response.data?.messageId) {
        return response.data.messageId;
      }
    } catch (error) {
      console.error("[WhatsApp] Stream start error:", error);
    }

    return undefined;
  }

  /**
   * 更新消息内容 (流式更新)
   */
  override async editMessage(
    _channelId: string,
    messageId: string,
    text: string
  ): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.bridgeRequest(
        "POST",
        "/stream/update",
        {
          messageId,
          content: text,
          sessionId: this.config.sessionId,
        }
      );
    } catch (error) {
      console.error("[WhatsApp] Stream update error:", error);
    }
  }

  /**
   * 完成流式输出
   */
  async completeStream(messageId: string): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.bridgeRequest(
        "POST",
        "/stream/end",
        {
          messageId,
          sessionId: this.config.sessionId,
        }
      );
    } catch (error) {
      console.error("[WhatsApp] Stream end error:", error);
    }
  }

  // ============================================
  // 消息状态和交互
  // ============================================

  /**
   * 标记消息已读
   */
  async markAsRead(messageId: string): Promise<void> {
    if (!this.connected) {
      return;
    }

    await this.bridgeRequest(
      "POST",
      "/messages/read",
      {
        messageId,
        sessionId: this.config.sessionId,
      }
    );
  }

  /**
   * 获取消息状态
   */
  async getMessageStatus(
    messageId: string
  ): Promise<"sent" | "delivered" | "read" | "failed" | null> {
    if (!this.connected) {
      return null;
    }

    const response = await this.bridgeRequest<{ status: string }>(
      "GET",
      `/messages/${messageId}/status`
    );

    return response.success ? (response.data?.status as "sent" | "delivered" | "read" | "failed") : null;
  }

  /**
   * 发送正在输入状态
   */
  async sendTypingIndicator(channelId: string): Promise<void> {
    if (!this.connected) {
      return;
    }

    await this.bridgeRequest(
      "POST",
      "/chat/presence",
      {
        to: channelId,
        presence: "composing",
        sessionId: this.config.sessionId,
      }
    );
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 开始轮询消息
   */
  private startPolling(): void {
    this.pollingInterval = setInterval(async () => {
      try {
        const response = await this.bridgeRequest<BridgeMessage[]>(
          "GET",
          `/messages?limit=50&sessionId=${this.config.sessionId || "default"}`
        );

        if (response.success && response.data) {
          for (const msg of response.data) {
            // 避免重复处理
            if (this.messageQueue.some((m) => m.id === msg.id)) {
              continue;
            }

            this.messageQueue.push(msg);
            // 保持队列大小
            if (this.messageQueue.length > 1000) {
              this.messageQueue.shift();
            }

            this.processIncomingMessage(msg);
          }
        }
      } catch (error) {
        console.error("[WhatsApp] Polling error:", error);
        this.handleConnectionError();
      }
    }, this.config.pollingInterval);
  }

  /**
   * 停止轮询
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * 连接 WebSocket 实时消息
   */
  private async connectWebSocket(): Promise<void> {
    const wsUrl = this.config.bridgeUrl.replace(/^http/, "ws") + "/ws";

    return new Promise((resolve, reject) => {
      try {
        this.webSocket = new WebSocket(wsUrl);

        this.webSocket.onopen = () => {
          console.log("[WhatsApp] WebSocket connected");
          // 发送认证
          if (this.config.bridgeToken) {
            this.webSocket?.send(
              JSON.stringify({
                type: "auth",
                token: this.config.bridgeToken,
                sessionId: this.config.sessionId,
              })
            );
          }
          resolve();
        };

        this.webSocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as {
              type: string;
              message?: BridgeMessage;
            };

            if (data.type === "message" && data.message) {
              this.processIncomingMessage(data.message);
            }
          } catch {
            // 忽略解析错误
          }
        };

        this.webSocket.onerror = (error) => {
          console.error("[WhatsApp] WebSocket error:", error);
          reject(error);
        };

        this.webSocket.onclose = () => {
          console.log("[WhatsApp] WebSocket closed");
          this.handleConnectionError();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 断开 WebSocket
   */
  private disconnectWebSocket(): void {
    if (this.webSocket) {
      this.webSocket.close();
      this.webSocket = null;
    }
  }

  /**
   * 处理连接错误
   */
  private handleConnectionError(): void {
    if (this.connected && !this.isReconnecting) {
      this.isReconnecting = true;
      this.scheduleReconnect();
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    this.reconnectTimeout = setTimeout(async () => {
      console.log("[WhatsApp] Reconnecting...");
      try {
        await this.connect();
        this.isReconnecting = false;
        console.log("[WhatsApp] Reconnected successfully");
      } catch (error) {
        console.error("[WhatsApp] Reconnect failed:", error);
        this.scheduleReconnect();
      }
    }, this.config.reconnectDelay);
  }

  /**
   * 清除重连定时器
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isReconnecting = false;
  }

  /**
   * 处理接收到的消息
   */
  private processIncomingMessage(msg: BridgeMessage): void {
    const imMessage: IMMessage = {
      id: msg.id,
      platform: "whatsapp",
      channelId: msg.from, // 发送者作为频道 ID
      userId: msg.metadata?.participant || msg.from,
      content: msg.content || msg.metadata?.caption || "",
      timestamp: msg.timestamp * 1000,
      metadata: {
        pushName: msg.metadata?.pushName,
        isGroup: msg.metadata?.isGroup,
        type: msg.type,
        mimeType: msg.metadata?.mimeType,
        fileName: msg.metadata?.fileName,
        mediaUrl: msg.media?.url,
        mediaBase64: msg.media?.base64,
        // 位置信息
        latitude: msg.metadata?.latitude,
        longitude: msg.metadata?.longitude,
      },
    };

    this.emitMessage(imMessage);
  }

  /**
   * 桥接服务请求
   */
  private async bridgeRequest<T = unknown>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<BridgeResponse<T>> {
    const url = `${this.config.bridgeUrl}${path}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.bridgeToken) {
      headers["Authorization"] = `Bearer ${this.config.bridgeToken}`;
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && method === "POST") {
      fetchOptions.body = JSON.stringify(body);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout
      );

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return (await response.json()) as BridgeResponse<T>;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
