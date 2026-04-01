/**
 * 流式聊天控制器
 *
 * 将 SACODEClient 的流式输出与 IM 适配器的流式发送能力集成
 */

import { SACODEClient } from "../client/index.js";
import type { BaseAdapter, StreamSender, IMMessage, Platform } from "@SACODE/adapters";
import EventEmitter from "eventemitter3";

// ============================================
// 类型定义
// ============================================

export interface StreamChatOptions {
  /** 会话 ID */
  sessionId: string;
  /** 频道 ID（IM 平台的聊天 ID） */
  channelId: string;
  /** 用户消息 */
  message: string;
  /** 初始消息（流式开始前显示） */
  initialMessage?: string;
  /** 流式更新间隔（毫秒） */
  updateInterval?: number;
  /** 是否保存消息到数据库 */
  saveToDatabase?: boolean;
}

export interface StreamChatResult {
  /** 完整响应内容 */
  content: string;
  /** 消息 ID（如果适配器支持） */
  messageId?: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

export interface StreamChatEvents {
  start: (data: { sessionId: string; channelId: string }) => void;
  chunk: (data: { content: string; accumulated: string }) => void;
  complete: (data: StreamChatResult) => void;
  error: (data: { error: Error }) => void;
}

// ============================================
// 流式聊天控制器
// ============================================

export class StreamChatController extends EventEmitter<StreamChatEvents> {
  private client: SACODEClient;
  private adapter: BaseAdapter & Partial<StreamSender>;
  private updateInterval: number;
  private updateTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingUpdates: Map<string, string> = new Map();
  private messageIds: Map<string, string> = new Map();

  constructor(
    client: SACODEClient,
    adapter: BaseAdapter & Partial<StreamSender>,
    options: { updateInterval?: number } = {}
  ) {
    super();
    this.client = client;
    this.adapter = adapter;
    this.updateInterval = options.updateInterval ?? 500;
  }

  /**
   * 检查适配器是否支持流式输出
   */
  supportsStreaming(): boolean {
    return typeof this.adapter.supportsStreaming === "function" 
      && this.adapter.supportsStreaming() 
      && typeof this.adapter.sendInitial === "function"
      && typeof this.adapter.editMessage === "function";
  }

  /**
   * 流式聊天
   */
  async chat(options: StreamChatOptions): Promise<StreamChatResult> {
    const { sessionId, channelId } = options;

    this.emit("start", { sessionId, channelId });

    try {
      // 如果适配器支持流式输出
      if (this.supportsStreaming()) {
        return await this.streamWithAdapter(options);
      }

      // 否则使用传统方式
      return await this.chatWithoutStreaming(options);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit("error", { error: err });
      return {
        content: "",
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * 使用适配器流式输出
   */
  private async streamWithAdapter(options: StreamChatOptions): Promise<StreamChatResult> {
    const { sessionId, channelId, message, initialMessage } = options;
    const streamId = `${sessionId}:${channelId}`;

    // 发送初始消息
    const initialText = initialMessage ?? "正在思考...";
    const messageId = await this.adapter.sendInitial!(channelId, initialText);
    
    if (messageId) {
      this.messageIds.set(streamId, messageId);
    }

    // 开始流式聊天
    let accumulatedContent = "";

    // 设置更新定时器
    const timer = setInterval(() => {
      this.flushUpdate(streamId, channelId);
    }, this.updateInterval);
    
    this.updateTimers.set(streamId, timer);

    try {
      for await (const chunk of this.client.chat(message, sessionId)) {
        const content = this.extractContent(chunk);
        if (content) {
          accumulatedContent += content;
          this.pendingUpdates.set(streamId, accumulatedContent);
          this.emit("chunk", { content, accumulated: accumulatedContent });
        }
      }
    } finally {
      // 清除定时器
      const t = this.updateTimers.get(streamId);
      if (t) {
        clearInterval(t);
        this.updateTimers.delete(streamId);
      }
    }

    // 最终更新
    await this.flushUpdate(streamId, channelId, true);

    const result: StreamChatResult = {
      content: accumulatedContent,
      success: true,
    };

    if (messageId !== undefined) {
      result.messageId = messageId;
    }

    this.emit("complete", result);
    return result;
  }

  /**
   * 传统聊天（非流式）
   */
  private async chatWithoutStreaming(options: StreamChatOptions): Promise<StreamChatResult> {
    const { sessionId, channelId, message } = options;
    let accumulatedContent = "";

    for await (const chunk of this.client.chat(message, sessionId)) {
      const content = this.extractContent(chunk);
      if (content) {
        accumulatedContent += content;
        this.emit("chunk", { content, accumulated: accumulatedContent });
      }
    }

    // 发送完整消息
    const imMessage: IMMessage = {
      id: `msg_${Date.now()}`,
      platform: this.adapter.platform as Platform,
      channelId,
      userId: "assistant",
      content: accumulatedContent,
      timestamp: Date.now(),
    };
    await this.adapter.send(imMessage);

    const result: StreamChatResult = {
      content: accumulatedContent,
      success: true,
    };

    this.emit("complete", result);
    return result;
  }

  /**
   * 刷新更新到适配器
   */
  private async flushUpdate(streamId: string, channelId: string, isFinal = false): Promise<void> {
    const content = this.pendingUpdates.get(streamId);
    const messageId = this.messageIds.get(streamId);

    if (!content || !messageId) return;

    try {
      await this.adapter.editMessage!(channelId, messageId, content);
      
      if (isFinal) {
        this.pendingUpdates.delete(streamId);
        this.messageIds.delete(streamId);
      }
    } catch (error) {
      console.error("Failed to update message:", error);
    }
  }

  /**
   * 从响应块中提取内容
   */
  private extractContent(chunk: unknown): string {
    if (typeof chunk === "string") {
      return chunk;
    }

    if (typeof chunk === "object" && chunk !== null) {
      const obj = chunk as Record<string, unknown>;
      
      // 常见的响应格式
      if (typeof obj.content === "string") {
        return obj.content;
      }
      if (typeof obj.text === "string") {
        return obj.text;
      }
      if (typeof obj.delta === "string") {
        return obj.delta;
      }
      if (typeof obj.message === "string") {
        return obj.message;
      }
    }

    return "";
  }

  /**
   * 取消流式聊天
   */
  cancel(sessionId: string, channelId: string): void {
    const streamId = `${sessionId}:${channelId}`;
    
    const timer = this.updateTimers.get(streamId);
    if (timer) {
      clearInterval(timer);
      this.updateTimers.delete(streamId);
    }

    this.pendingUpdates.delete(streamId);
    this.messageIds.delete(streamId);
  }

  /**
   * 清理所有资源
   */
  destroy(): void {
    for (const timer of this.updateTimers.values()) {
      clearInterval(timer);
    }
    this.updateTimers.clear();
    this.pendingUpdates.clear();
    this.messageIds.clear();
  }
}

// ============================================
// 工厂函数
// ============================================

export function createStreamChatController(
  client: SACODEClient,
  adapter: BaseAdapter & Partial<StreamSender>,
  options?: { updateInterval?: number }
): StreamChatController {
  return new StreamChatController(client, adapter, options);
}
