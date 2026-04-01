/**
 * SACODE Shared Types - IM 适配器类型
 *
 * 此模块定义了 IM 平台适配器的共享类型。
 */

// ============================================================================
// 平台类型
// ============================================================================

/**
 * 支持的 IM 平台
 */
export type Platform =
  | "wechat"
  | "qq"
  | "telegram"
  | "discord"
  | "dingtalk"
  | "feishu"
  | "xiaoyi"
  | "whatsapp"
  | "slack"
  | "email";

// ============================================================================
// 适配器配置
// ============================================================================

/**
 * IM 适配器配置
 */
export interface IMConfig {
  platform: Platform;
  config: Record<string, unknown>;
}

// ============================================================================
// 频道类型
// ============================================================================

/**
 * 频道类型
 */
export type ChannelType = "private" | "group" | "channel";

/**
 * 频道信息
 */
export interface Channel {
  /** 频道 ID */
  id: string;
  /** 频道名称 */
  name: string;
  /** 频道类型 */
  type: ChannelType;
  /** 额外元数据 */
  metadata?: Record<string, unknown> | undefined;
}

// ============================================================================
// 消息类型
// ============================================================================

/**
 * IM 消息基础接口
 */
export interface IMMessage {
  /** 消息 ID */
  id: string;
  /** 平台标识 */
  platform: Platform;
  /** 频道 ID */
  channelId: string;
  /** 用户 ID */
  userId: string;
  /** 文本内容 */
  content: string;
  /** 多媒体内容列表 */
  contents?: import("./message.js").MessageContent[] | undefined;
  /** 时间戳 (毫秒) */
  timestamp: number;
  /** 回复的消息 ID */
  replyTo?: string | undefined;
  /** 元数据 */
  metadata?: Record<string, unknown> | undefined;
}

/**
 * 多媒体消息 (必须有 contents)
 */
export interface IMMediaMessage extends IMMessage {
  contents: import("./message.js").MessageContent[];
}

// ============================================================================
// 适配器接口
// ============================================================================

/**
 * IM 适配器基础接口
 */
export interface IMAdapter {
  /** 平台标识 */
  readonly platform: Platform;
  /** 连接到平台 */
  connect(): Promise<void>;
  /** 断开连接 */
  disconnect(): Promise<void>;
  /** 发送消息 */
  send(message: IMMessage): Promise<void>;
  /** 监听消息 */
  onMessage(callback: (message: IMMessage) => void): void;
  /** 是否已连接 */
  isConnected(): boolean;
  /** 获取频道列表 */
  getChannels(): Promise<Channel[]>;
}

// ============================================================================
// 发送选项
// ============================================================================

/**
 * 消息发送选项
 */
export interface SendOptions {
  /** 回复的消息 ID */
  replyTo?: string | undefined;
  /** 是否解析 Markdown */
  parseMarkdown?: boolean | undefined;
  /** 禁用通知 */
  silent?: boolean | undefined;
}

/**
 * 流式发送选项
 */
export interface StreamOptions extends SendOptions {
  /** 初始消息 */
  initialMessage?: string | undefined;
  /** 更新间隔 (毫秒) */
  updateInterval?: number | undefined;
}
