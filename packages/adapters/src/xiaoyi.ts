import { BaseAdapter } from "./base.js";
import type { IMMessage, IMMediaMessage, Channel, Platform } from "./types/index.js";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

// ============================================
// 类型定义
// ============================================

/**
 * 华为小艺适配器配置
 */
interface XiaoyiConfig {
  /** Access Key ID */
  ak: string;
  /** Secret Access Key */
  sk: string;
  /** 智能体 ID */
  agentId: string;
  /** WebSocket 服务地址 (可选，默认为华为云地址) */
  wsUrl?: string;
  /** 项目 ID (可选，多租户场景) */
  projectId?: string;
  /** 重连延迟 (毫秒) */
  reconnectDelay?: number;
  /** 心跳间隔 (毫秒) */
  heartbeatInterval?: number;
  /** 消息超时 (毫秒) */
  messageTimeout?: number;
}

/**
 * 小艺 WebSocket 消息类型
 */
interface XiaoyiWSMessage {
  /** 消息类型 */
  type: "init" | "message" | "stream" | "heartbeat" | "ack" | "error" | "close";
  /** 消息内容 */
  payload: XiaoyiPayload;
  /** 时间戳 (毫秒) */
  timestamp: number;
  /** 消息 ID */
  messageId?: string;
}

/**
 * 小艺消息载荷
 */
interface XiaoyiPayload {
  /** 操作类型 */
  action?: string;
  /** 会话 ID */
  sessionId?: string;
  /** 用户 ID */
  userId?: string;
  /** 消息内容 */
  content?: string;
  /** 消息类型 */
  messageType?: "text" | "image" | "audio" | "video" | "card" | "stream";
  /** 智能体 ID */
  agentId?: string;
  /** 错误码 */
  errorCode?: number;
  /** 错误信息 */
  errorMessage?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 流式内容块 */
  streamChunk?: {
    index: number;
    content: string;
    isFinished: boolean;
  };
  /** 多媒体 URL */
  mediaUrl?: string;
}

/**
 * 小艺初始化响应
 */
interface XiaoyiInitResponse {
  success: boolean;
  sessionId?: string;
  errorCode?: number;
  errorMessage?: string;
}

/**
 * 流式响应事件
 */
interface StreamChunkEvent {
  messageId: string;
  sessionId: string;
  chunkIndex: number;
  content: string;
  isFinished: boolean;
}

/**
 * 多媒体消息
 */
interface MediaMessage {
  type: "image" | "audio" | "video";
  url: string;
  caption?: string | undefined;
  duration?: number | undefined; // 音频/视频时长 (秒)
}

/**
 * 小艺事件映射
 */
interface XiaoyiEvents {
  message: (message: IMMessage) => void;
  stream: (event: StreamChunkEvent) => void;
  error: (error: Error) => void;
  connect: () => void;
  disconnect: (reason: string) => void;
}

/**
 * 华为小艺适配器
 *
 * 通过 WebSocket 长连接与小艺开放平台通信
 * 使用 AK/SK 签名进行认证
 * 支持流式输出和多媒体消息
 *
 * @see https://developer.huawei.com/consumer/cn/doc/service/openclaw-0000002518410344
 */
export class XiaoyiAdapter extends BaseAdapter {
  platform: Platform = "xiaoyi";

  private config: Required<
    Pick<XiaoyiConfig, "ak" | "sk" | "agentId">
  > &
    XiaoyiConfig;
  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null = null;
  private isReconnecting = false;
  private eventEmitter: EventEmitter;

  // 流式输出状态
  private streamBuffers: Map<string, string> = new Map();
  private pendingMessages: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  > = new Map();

  constructor(config: XiaoyiConfig) {
    super();
    this.config = {
      reconnectDelay: 5000,
      heartbeatInterval: 30000,
      messageTimeout: 60000,
      ...config,
    };
    this.eventEmitter = new EventEmitter();
  }

  /**
   * 建立 WebSocket 连接
   */
  async connect(): Promise<void> {
    if (!this.config.ak || !this.config.sk || !this.config.agentId) {
      throw new Error("[Xiaoyi] AK, SK and AgentId are required");
    }

    const wsUrl = this.config.wsUrl || this.getDefaultWsUrl();
    const signedUrl = this.signWebSocketUrl(wsUrl);

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(signedUrl);

        this.ws.onopen = () => {
          console.log("[Xiaoyi] WebSocket connected, initializing...");
          this.sendInit();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data as string);
        };

        this.ws.onerror = (error) => {
          console.error("[Xiaoyi] WebSocket error:", error);
          if (!this.connected) {
            reject(new Error("[Xiaoyi] WebSocket connection failed"));
          }
        };

        this.ws.onclose = (event) => {
          console.log("[Xiaoyi] WebSocket closed:", event.code, event.reason);
          this.handleDisconnect(event.reason);
        };

        // 等待初始化完成的超时
        const initTimeout = setTimeout(() => {
          if (!this.connected) {
            reject(new Error("[Xiaoyi] Initialization timeout"));
          }
        }, 10000);

        // 检查连接状态
        const checkInterval = setInterval(() => {
          if (this.connected) {
            clearTimeout(initTimeout);
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.clearPendingMessages();

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this.connected = false;
    this.sessionId = null;
  }

  /**
   * 发送文本消息
   */
  async send(message: IMMessage): Promise<void> {
    if (!this.connected || !this.ws) {
      throw new Error("[Xiaoyi] Not connected");
    }

    const payload: XiaoyiPayload = {
      action: "send",
      userId: message.userId,
      content: message.content,
      messageType: "text",
    };

    if (this.sessionId) {
      payload.sessionId = this.sessionId;
    }

    const wsMessage: XiaoyiWSMessage = {
      type: "message",
      payload,
      timestamp: Date.now(),
      messageId: message.id,
    };

    this.ws.send(JSON.stringify(wsMessage));
  }

  /**
   * 发送多媒体消息 (实现基类接口)
   */
  override async sendMedia(message: IMMediaMessage): Promise<string | undefined> {
    if (!this.connected || !this.ws) {
      throw new Error("[Xiaoyi] Not connected");
    }

    // 处理多媒体内容
    for (const content of message.contents) {
      if (content.type === "image" || content.type === "audio" || content.type === "video") {
        await this.sendMediaByType(message.channelId, {
          type: content.type,
          url: content.url || "",
          caption: content.type === "image" ? content.caption : content.type === "video" ? content.caption : undefined,
        });
      }
    }

    return undefined;
  }

  /**
   * 通过类型发送多媒体消息
   */
  async sendMediaByType(
    userId: string,
    media: MediaMessage
  ): Promise<void> {
    if (!this.connected || !this.ws) {
      throw new Error("[Xiaoyi] Not connected");
    }

    const payload: XiaoyiPayload = {
      action: "send",
      userId,
      messageType: media.type,
      mediaUrl: media.url,
    };

    if (media.caption) {
      payload.content = media.caption;
    }

    if (media.duration) {
      payload.metadata = { duration: media.duration };
    }

    if (this.sessionId) {
      payload.sessionId = this.sessionId;
    }

    const wsMessage: XiaoyiWSMessage = {
      type: "message",
      payload,
      timestamp: Date.now(),
      messageId: crypto.randomUUID(),
    };

    this.ws.send(JSON.stringify(wsMessage));
  }

  /**
   * 发送消息并等待响应 (支持流式)
   */
  async sendAndWait(
    message: IMMessage,
    options?: {
      streaming?: boolean;
      onChunk?: (chunk: string) => void;
    }
  ): Promise<string> {
    if (!this.connected || !this.ws) {
      throw new Error("[Xiaoyi] Not connected");
    }

    return new Promise((resolve, reject) => {
      const messageId = message.id;
      let fullContent = "";

      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingMessages.delete(messageId);
        reject(new Error("[Xiaoyi] Message timeout"));
      }, this.config.messageTimeout);

      // 监听流式响应
      const streamHandler = (event: StreamChunkEvent) => {
        if (event.messageId === messageId) {
          fullContent += event.content;
          options?.onChunk?.(event.content);

          if (event.isFinished) {
            this.eventEmitter.off("stream", streamHandler);
            this.pendingMessages.delete(messageId);
            clearTimeout(timeout);
            resolve(fullContent);
          }
        }
      };

      if (options?.streaming) {
        this.eventEmitter.on("stream", streamHandler);
      }

      // 存储等待的 Promise
      this.pendingMessages.set(messageId, {
        resolve: (content) => {
          if (!options?.streaming) {
            resolve(content as string);
          }
        },
        reject,
        timeout,
      });

      // 发送消息
      this.send(message);
    });
  }

  /**
   * 获取频道列表
   * 小艺平台暂时不支持主动获取频道列表
   */
  async getChannels(): Promise<Channel[]> {
    return [];
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
   */
  override async sendInitial(
    channelId: string,
    text: string
  ): Promise<string | undefined> {
    if (!this.connected || !this.ws) {
      return undefined;
    }

    const messageId = crypto.randomUUID();
    this.streamBuffers.set(messageId, "");

    const payload: XiaoyiPayload = {
      action: "stream_start",
      userId: channelId,
      content: text,
      messageType: "stream",
    };

    if (this.sessionId) {
      payload.sessionId = this.sessionId;
    }

    const wsMessage: XiaoyiWSMessage = {
      type: "stream",
      payload,
      timestamp: Date.now(),
      messageId,
    };

    this.ws.send(JSON.stringify(wsMessage));
    return messageId;
  }

  /**
   * 更新消息内容 (流式更新)
   */
  override async editMessage(
    _channelId: string,
    messageId: string,
    text: string
  ): Promise<void> {
    if (!this.connected || !this.ws) {
      return;
    }

    const payload: XiaoyiPayload = {
      action: "stream_update",
      content: text,
      messageType: "stream",
    };

    if (this.sessionId) {
      payload.sessionId = this.sessionId;
    }

    const wsMessage: XiaoyiWSMessage = {
      type: "stream",
      payload,
      timestamp: Date.now(),
      messageId,
    };

    this.ws.send(JSON.stringify(wsMessage));
  }

  /**
   * 完成流式输出
   */
  async completeStream(messageId: string): Promise<void> {
    if (!this.connected || !this.ws) {
      return;
    }

    const payload: XiaoyiPayload = {
      action: "stream_end",
      messageType: "stream",
    };

    if (this.sessionId) {
      payload.sessionId = this.sessionId;
    }

    const wsMessage: XiaoyiWSMessage = {
      type: "stream",
      payload,
      timestamp: Date.now(),
      messageId,
    };

    this.ws.send(JSON.stringify(wsMessage));
    this.streamBuffers.delete(messageId);
  }

  // ============================================
  // 事件监听
  // ============================================

  /**
   * 监听事件
   */
  on<K extends keyof XiaoyiEvents>(
    event: K,
    listener: XiaoyiEvents[K]
  ): this {
    this.eventEmitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * 取消监听
   */
  off<K extends keyof XiaoyiEvents>(
    event: K,
    listener: XiaoyiEvents[K]
  ): this {
    this.eventEmitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 获取默认 WebSocket 地址
   */
  private getDefaultWsUrl(): string {
    const base = "wss://openclaw.huawei.com/ws";
    const params = new URLSearchParams({
      agentId: this.config.agentId,
      ak: this.config.ak,
    });

    if (this.config.projectId) {
      params.set("projectId", this.config.projectId);
    }

    return `${base}?${params.toString()}`;
  }

  /**
   * AK/SK 签名 WebSocket URL
   * 参考: 华为云签名规范
   */
  private signWebSocketUrl(url: string): string {
    const urlObj = new URL(url);
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString("hex");

    // 构建签名字符串
    const method = "GET";
    const path = urlObj.pathname;
    const query = urlObj.searchParams.toString();
    const stringToSign = `${method}\n${path}\n${query}\n${timestamp}\n${nonce}`;

    // HMAC-SHA256 签名
    const signature = crypto
      .createHmac("sha256", this.config.sk)
      .update(stringToSign)
      .digest("hex");

    // 添加签名参数
    urlObj.searchParams.set("timestamp", timestamp);
    urlObj.searchParams.set("nonce", nonce);
    urlObj.searchParams.set("signature", signature);

    return urlObj.toString();
  }

  /**
   * 发送初始化消息
   */
  private sendInit(): void {
    if (!this.ws) return;

    const initMessage: XiaoyiWSMessage = {
      type: "init",
      payload: {
        action: "claw_bot_init",
        agentId: this.config.agentId,
      },
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(initMessage));
  }

  /**
   * 处理 WebSocket 消息
   */
  private handleMessage(data: string): void {
    try {
      const message: XiaoyiWSMessage = JSON.parse(data);

      switch (message.type) {
        case "init":
          this.handleInitResponse(message.payload as XiaoyiInitResponse);
          break;

        case "message":
          this.handleXiaoyiMessage(message);
          break;

        case "stream":
          this.handleStreamMessage(message);
          break;

        case "ack":
          this.handleAckMessage(message);
          break;

        case "error":
          this.handleErrorMessage(message);
          break;

        case "heartbeat":
          // 心跳响应
          break;

        case "close":
          this.handleDisconnect(
            message.payload.errorMessage || "Server closed"
          );
          break;

        default:
          console.warn("[Xiaoyi] Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("[Xiaoyi] Failed to parse message:", error);
    }
  }

  /**
   * 处理初始化响应
   */
  private handleInitResponse(response: XiaoyiInitResponse): void {
    if (response.success) {
      this.connected = true;
      this.sessionId = response.sessionId || null;
      console.log(
        "[Xiaoyi] Initialized successfully, sessionId:",
        this.sessionId
      );
      this.startHeartbeat();
      this.eventEmitter.emit("connect");
    } else {
      console.error(
        "[Xiaoyi] Initialization failed:",
        response.errorCode,
        response.errorMessage
      );
      this.ws?.close(1011, "Init failed");
    }
  }

  /**
   * 处理小艺消息
   */
  private handleXiaoyiMessage(wsMessage: XiaoyiWSMessage): void {
    const { payload } = wsMessage;

    if (!payload.userId || !payload.content) {
      return;
    }

    const message: IMMessage = {
      id: wsMessage.messageId || crypto.randomUUID(),
      platform: "xiaoyi",
      channelId: payload.sessionId || "default",
      userId: payload.userId,
      content: payload.content,
      timestamp: wsMessage.timestamp,
      metadata: {
        messageType: payload.messageType,
        metadata: payload.metadata,
        mediaUrl: payload.mediaUrl,
      },
    };

    this.emitMessage(message);
    this.eventEmitter.emit("message", message);
  }

  /**
   * 处理流式消息
   */
  private handleStreamMessage(wsMessage: XiaoyiWSMessage): void {
    const { payload, messageId } = wsMessage;

    if (!messageId || !payload.streamChunk) {
      return;
    }

    const event: StreamChunkEvent = {
      messageId,
      sessionId: payload.sessionId || "",
      chunkIndex: payload.streamChunk.index,
      content: payload.streamChunk.content,
      isFinished: payload.streamChunk.isFinished,
    };

    this.eventEmitter.emit("stream", event);

    // 更新缓冲区
    const buffer = this.streamBuffers.get(messageId) || "";
    this.streamBuffers.set(messageId, buffer + payload.streamChunk.content);

    // 如果流式结束，处理完整消息
    if (payload.streamChunk.isFinished) {
      const fullContent = this.streamBuffers.get(messageId) || "";

      const message: IMMessage = {
        id: messageId,
        platform: "xiaoyi",
        channelId: payload.sessionId || "default",
        userId: payload.userId || "system",
        content: fullContent,
        timestamp: wsMessage.timestamp,
        metadata: {
          messageType: "stream",
        },
      };

      this.emitMessage(message);
      this.streamBuffers.delete(messageId);
    }
  }

  /**
   * 处理确认消息
   */
  private handleAckMessage(wsMessage: XiaoyiWSMessage): void {
    const { messageId } = wsMessage;
    const pending = this.pendingMessages.get(messageId || "");

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingMessages.delete(messageId || "");

      // 如果不是流式消息，直接 resolve
      const buffer = this.streamBuffers.get(messageId || "");
      if (buffer === undefined) {
        pending.resolve(wsMessage.payload.content || "");
      }
    }
  }

  /**
   * 处理错误消息
   */
  private handleErrorMessage(wsMessage: XiaoyiWSMessage): void {
    const { payload, messageId } = wsMessage;
    const error = new Error(
      `[Xiaoyi] Error ${payload.errorCode}: ${payload.errorMessage}`
    );

    console.error(error.message);
    this.eventEmitter.emit("error", error);

    // 拒绝等待中的消息
    if (messageId) {
      const pending = this.pendingMessages.get(messageId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingMessages.delete(messageId);
        pending.reject(error);
      }
    }
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.connected) {
        const heartbeat: XiaoyiWSMessage = {
          type: "heartbeat",
          payload: {},
          timestamp: Date.now(),
        };
        this.ws.send(JSON.stringify(heartbeat));
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(reason: string): void {
    this.stopHeartbeat();

    if (this.connected) {
      this.connected = false;
      console.log("[Xiaoyi] Disconnected:", reason);
      this.eventEmitter.emit("disconnect", reason);

      // 自动重连
      if (!this.isReconnecting) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    this.isReconnecting = true;

    this.reconnectTimeout = setTimeout(async () => {
      console.log("[Xiaoyi] Reconnecting...");
      try {
        await this.connect();
        this.isReconnecting = false;
        console.log("[Xiaoyi] Reconnected successfully");
      } catch (error) {
        console.error("[Xiaoyi] Reconnect failed:", error);
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
   * 清除等待中的消息
   */
  private clearPendingMessages(): void {
    for (const [_messageId, pending] of this.pendingMessages) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("[Xiaoyi] Connection closed"));
    }
    this.pendingMessages.clear();
    this.streamBuffers.clear();
  }
}
