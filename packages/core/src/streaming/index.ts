import EventEmitter from "eventemitter3";
import type { Platform } from "../session/types.js";
import {
  defaultStreamingConfig,
} from "./types.js";
import type {
  StreamingSession,
  StreamingConfig,
  StreamChunk,
  StreamingEvent,
  StreamSender,
  StreamingCallback,
} from "./types.js";

// 重新导出类型
export type {
  StreamChunk,
  StreamingSession,
  StreamingConfig,
  StreamingEvent,
  StreamSender,
  StreamingCallback,
};
export { defaultStreamingConfig };

/**
 * 流式输出管理器
 * 
 * 参考 iflow-bot 实现方案：
 * - 缓冲机制：累积 10-25 字符后推送更新
 * - 随机缓冲大小避免固定模式
 * - 支持多平台流式输出
 */
export class StreamingManager extends EventEmitter<{
  event: (event: StreamingEvent) => void;
}> {
  private config: StreamingConfig;
  private sessions: Map<string, StreamingSession> = new Map();
  private senders: Map<Platform, StreamSender> = new Map();
  private flushTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<StreamingConfig> = {}) {
    super();
    this.config = { ...defaultStreamingConfig, ...config };
  }

  /**
   * 注册流式发送器
   */
  registerSender(platform: Platform, sender: StreamSender): void {
    this.senders.set(platform, sender);
  }

  /**
   * 开始流式会话
   */
  async startSession(
    platform: Platform,
    channelId: string,
    initialText = ""
  ): Promise<string> {
    const sessionId = this.generateSessionId();
    const now = Date.now();

    const session: StreamingSession = {
      id: sessionId,
      platform,
      channelId,
      accumulatedText: initialText,
      sentLength: 0,
      startTime: now,
      lastUpdateTime: now,
    };

    // 如果有初始文本，发送初始消息
    if (initialText && this.config.enabled) {
      const sender = this.senders.get(platform);
      if (sender?.supportsStreaming()) {
        const msgId = await sender.sendInitial(channelId, initialText);
        if (msgId) {
          session.messageId = msgId;
        }
        session.sentLength = initialText.length;
      }
    }

    this.sessions.set(sessionId, session);

    this.emit("event", {
      type: "start",
      sessionId,
    });

    return sessionId;
  }

  /**
   * 追加文本到流式会话
   */
  async appendChunk(sessionId: string, chunk: StreamChunk): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // 累积文本
    session.accumulatedText += chunk.text;
    session.lastUpdateTime = Date.now();

    // 计算需要发送的文本
    const pendingLength = session.accumulatedText.length - session.sentLength;

    // 检查是否需要刷新
    const shouldFlushNow = this.shouldFlush(pendingLength, chunk.isComplete);

    if (shouldFlushNow) {
      await this.flushSession(sessionId);
    } else {
      // 设置定时刷新
      this.scheduleFlush(sessionId);
    }

    this.emit("event", {
      type: "chunk",
      sessionId,
      data: chunk,
    });
  }

  /**
   * 完成流式会话
   */
  async completeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // 清除定时器
    this.clearFlushTimer(sessionId);

    // 发送剩余文本
    if (session.accumulatedText.length > session.sentLength) {
      await this.flushSession(sessionId);
    }

    const completeChunk: StreamChunk = {
      text: session.accumulatedText,
      isComplete: true,
    };
    if (session.messageId) {
      completeChunk.messageId = session.messageId;
    }

    this.emit("event", {
      type: "complete",
      sessionId,
      data: completeChunk,
    });

    this.sessions.delete(sessionId);
  }

  /**
   * 错误处理
   */
  errorSession(sessionId: string, error: Error): void {
    this.emit("event", {
      type: "error",
      sessionId,
      data: error,
    });

    this.clearFlushTimer(sessionId);
    this.sessions.delete(sessionId);
  }

  /**
   * 获取会话状态
   */
  getSession(sessionId: string): StreamingSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有活跃会话
   */
  getActiveSessions(): StreamingSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 清理所有会话
   */
  async cleanup(): Promise<void> {
    for (const sessionId of this.sessions.keys()) {
      this.clearFlushTimer(sessionId);
    }
    this.sessions.clear();
  }

  /**
   * 判断是否需要刷新
   */
  private shouldFlush(pendingLength: number, isComplete: boolean): boolean {
    if (!this.config.enabled) {
      return isComplete;
    }

    if (isComplete) {
      return true;
    }

    // 随机缓冲大小 (10-25)
    const bufferSize = this.getRandomBufferSize();
    return pendingLength >= bufferSize;
  }

  /**
   * 获取随机缓冲大小
   */
  private getRandomBufferSize(): number {
    const { minBufferSize, maxBufferSize } = this.config;
    return Math.floor(Math.random() * (maxBufferSize - minBufferSize + 1)) + minBufferSize;
  }

  /**
   * 刷新会话 (发送累积文本)
   */
  private async flushSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const sender = this.senders.get(session.platform);
    if (!sender?.supportsStreaming()) {
      return;
    }

    const textToSend = session.accumulatedText.slice(0, this.config.maxMessageLength);

    try {
      if (session.messageId) {
        // 编辑现有消息
        await sender.editMessage(session.channelId, session.messageId, textToSend);
      } else {
        // 发送新消息
        const msgId = await sender.sendInitial(session.channelId, textToSend);
        if (msgId) {
          session.messageId = msgId;
        }
      }

      session.sentLength = textToSend.length;
    } catch (error) {
      console.error("[StreamingManager] Flush error:", error);
      // 不抛出错误，继续流式
    }
  }

  /**
   * 调度定时刷新
   */
  private scheduleFlush(sessionId: string): void {
    this.clearFlushTimer(sessionId);

    const timer = setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (session && session.accumulatedText.length > session.sentLength) {
        this.flushSession(sessionId);
      }
    }, this.config.sendInterval);

    this.flushTimers.set(sessionId, timer);
  }

  /**
   * 清除刷新定时器
   */
  private clearFlushTimer(sessionId: string): void {
    const timer = this.flushTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(sessionId);
    }
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    return `stream_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

/**
 * 创建流式管理器
 */
export function createStreamingManager(
  config?: Partial<StreamingConfig>
): StreamingManager {
  return new StreamingManager(config);
}