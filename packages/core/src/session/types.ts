/**
 * 会话模块类型定义
 *
 * 包含会话管理和跨渠道映射相关的所有类型
 */

// ============================================================================
// 会话类型
// ============================================================================

/**
 * 会话状态
 */
export type SessionStatus = "active" | "idle" | "closed";

/**
 * 会话信息
 */
export interface Session {
  /** 会话唯一标识 */
  id: string;
  /** 渠道 ID (格式: {platform}:{chatId}) */
  channelId: string | undefined;
  /** 平台名称 */
  platform: string | undefined;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
  /** 消息计数 */
  messageCount: number;
  /** 会话状态 */
  status: SessionStatus;
  /** 自定义元数据 */
  metadata: Record<string, unknown> | undefined;
}

/**
 * 创建会话选项
 */
export interface SessionCreateOptions {
  /** 渠道 ID */
  channelId?: string;
  /** 平台名称 */
  platform?: string;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 会话更新选项
 */
export interface SessionUpdateOptions {
  /** 更新状态 */
  status?: SessionStatus;
  /** 更新元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 跨渠道映射类型
// ============================================================================

/**
 * 渠道标识符
 *
 * 格式：{platform}:{chatId}
 * 例如：
 * - telegram:123456789
 * - wechat:user_abc
 * - discord:channel_xyz
 */
export type ChannelIdentifier = `${string}:${string}`;

/**
 * 支持的平台类型
 */
export type Platform =
  | "telegram"
  | "wechat"
  | "qq"
  | "discord"
  | "dingtalk"
  | "feishu"
  | "xiaoyi"
  | "whatsapp"
  | "slack"
  | "email"
  | string; // 支持自定义平台

/**
 * 会话映射条目
 */
export interface SessionMappingEntry {
  /** 渠道标识符 */
  channel: ChannelIdentifier;
  /** 关联的会话 ID */
  sessionId: string;
  /** 平台名称 */
  platform: Platform;
  /** 聊天 ID */
  chatId: string;
  /** 创建时间 */
  createdAt: Date;
  /** 最后活跃时间 */
  lastActiveAt: Date;
  /** 自定义元数据 */
  metadata?: Record<string, unknown> | undefined;
}

/**
 * 会话映射器配置
 */
export interface SessionMapperConfig {
  /** 持久化文件路径，默认 ~/.SACODE/session_mappings.json */
  persistPath?: string;
  /** 是否启用持久化，默认 true */
  enablePersistence?: boolean;
  /** 会话 TTL (毫秒)，默认 24 小时 */
  sessionTTL?: number;
  /** 清理间隔 (毫秒)，默认 1 小时 */
  cleanupInterval?: number;
  /** 是否启用自动清理，默认 true */
  enableAutoCleanup?: boolean;
}

/**
 * 会话映射器事件映射
 */
export interface SessionMapperEvents {
  /** 新映射创建 */
  "mapping:created": { channel: ChannelIdentifier; sessionId: string };
  /** 映射更新 */
  "mapping:updated": { channel: ChannelIdentifier; sessionId: string };
  /** 映射删除 */
  "mapping:deleted": { channel: ChannelIdentifier; sessionId: string };
  /** 映射过期 */
  "mapping:expired": { channel: ChannelIdentifier; sessionId: string };
  /** 持久化完成 */
  "persistence:saved": { count: number };
  /** 持久化恢复完成 */
  "persistence:restored": { count: number };
  /** 清理完成 */
  "cleanup:completed": { expiredCount: number };
}

// ============================================================================
// 会话管理器配置
// ============================================================================

/**
 * 会话管理器配置
 */
export interface SessionManagerConfig {
  /** 会话 TTL (毫秒)，默认 24 小时 */
  sessionTTL?: number;
  /** 清理间隔 (毫秒)，默认 1 小时 */
  cleanupInterval?: number;
  /** 是否启用自动清理，默认 true */
  enableAutoCleanup?: boolean;
  /** 映射器配置 */
  mapperConfig?: SessionMapperConfig;
}

/**
 * 会话管理器事件映射
 */
export interface SessionManagerEvents {
  /** 会话创建 */
  "session:created": { session: Session };
  /** 会话更新 */
  "session:updated": { session: Session; changes: Partial<Session> };
  /** 会话关闭 */
  "session:closed": { session: Session };
  /** 会话删除 */
  "session:deleted": { sessionId: string };
  /** 会话过期 */
  "session:expired": { session: Session };
  /** 清理完成 */
  "cleanup:completed": { expiredCount: number };
}

// ============================================================================
// 工具类型
// ============================================================================

/**
 * 解析渠道标识符
 */
export type ParseChannel<T extends ChannelIdentifier> = T extends `${infer P}:${infer C}`
  ? { platform: P; chatId: C }
  : never;

/**
 * 构建渠道标识符
 */
export type BuildChannel<P extends string, C extends string> = `${P}:${C}`;
