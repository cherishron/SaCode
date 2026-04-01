import type { Platform } from "../session/types.js";

/**
 * 流式消息块
 */
export interface StreamChunk {
  /** 文本内容 */
  text: string;
  /** 是否完成 */
  isComplete: boolean;
  /** 消息 ID */
  messageId?: string;
}

/**
 * 流式会话状态
 */
export interface StreamingSession {
  /** 会话 ID */
  id: string;
  /** 平台 */
  platform: Platform;
  /** 频道 ID */
  channelId: string;
  /** 当前累积文本 */
  accumulatedText: string;
  /** 已发送文本长度 */
  sentLength: number;
  /** 消息 ID (用于编辑) */
  messageId?: string;
  /** 开始时间 */
  startTime: number;
  /** 最后更新时间 */
  lastUpdateTime: number;
}

/**
 * 流式配置
 */
export interface StreamingConfig {
  /** 最小缓冲字符数 (发送前累积) */
  minBufferSize: number;
  /** 最大缓冲字符数 */
  maxBufferSize: number;
  /** 发送间隔 (毫秒) */
  sendInterval: number;
  /** 最大单条消息长度 */
  maxMessageLength: number;
  /** 是否启用流式 */
  enabled: boolean;
}

/**
 * 默认流式配置
 */
export const defaultStreamingConfig: StreamingConfig = {
  minBufferSize: 10,
  maxBufferSize: 25,
  sendInterval: 100,
  maxMessageLength: 4096,
  enabled: true,
};

/**
 * 流式事件
 */
export interface StreamingEvent {
  type: "start" | "chunk" | "complete" | "error";
  sessionId: string;
  data?: StreamChunk | Error;
}

/**
 * 流式发送器接口
 */
export interface StreamSender {
  /**
   * 发送初始消息
   * @returns 消息 ID
   */
  sendInitial(channelId: string, text: string): Promise<string | undefined>;

  /**
   * 编辑消息 (流式更新)
   */
  editMessage(channelId: string, messageId: string, text: string): Promise<void>;

  /**
   * 检查是否支持流式
   */
  supportsStreaming(): boolean;
}

/**
 * 流式回调函数
 */
export type StreamingCallback = (event: StreamingEvent) => void;
