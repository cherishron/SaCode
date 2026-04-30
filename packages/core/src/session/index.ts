/**
 * 会话管理模块
 *
 * 提供完整的会话管理功能，包括：
 * - SessionManager: 会话生命周期管理
 * - SessionMapper: 跨渠道会话映射
 * - 自动过期清理机制
 *
 * @module session
 */

import EventEmitter from "eventemitter3";
import type {
  Session,
  SessionCreateOptions,
  SessionUpdateOptions,
  SessionManagerConfig,
  SessionManagerEvents,
  Platform,
} from "./types";
import { SessionMapper, createSessionMapper } from "./mapping";
import type { SessionMapperConfig } from "./types";

// 重新导出类型和映射器
export * from "./types";
export { SessionMapper, createSessionMapper } from "./mapping";

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_MANAGER_CONFIG: Required<Omit<SessionManagerConfig, "mapperConfig">> = {
  sessionTTL: 24 * 60 * 60 * 1000, // 24 小时
  cleanupInterval: 60 * 60 * 1000, // 1 小时
  enableAutoCleanup: true,
};

// ============================================================================
// SessionManager - 会话管理器
// ============================================================================

/**
 * 会话管理器
 *
 * 管理会话生命周期，集成跨渠道映射
 *
 * @example
 * ```typescript
 * const manager = new SessionManager();
 *
 * // 创建会话（自动创建映射）
 * const session = manager.create({
 *   platform: "telegram",
 *   channelId: "telegram:123456789"
 * });
 *
 * // 通过渠道获取会话
 * const found = manager.getByChannel("telegram", "123456789");
 *
 * // 清理过期会话
 * manager.cleanupExpired(3600000); // 清理 1 小时未活跃的会话
 * ```
 */
export class SessionManager extends EventEmitter<SessionManagerEvents> {
  private sessions: Map<string, Session> = new Map();
  private config: Required<Omit<SessionManagerConfig, "mapperConfig">>;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  /** 跨渠道会话映射器 */
  readonly mapping: SessionMapper;

  constructor(config: SessionManagerConfig = {}) {
    super();

    this.config = {
      ...DEFAULT_MANAGER_CONFIG,
      ...config,
    };

    // 初始化映射器
    const mapperConfig: SessionMapperConfig = {
      sessionTTL: this.config.sessionTTL,
      cleanupInterval: this.config.cleanupInterval,
      enableAutoCleanup: false, // 由 SessionManager 统一管理清理
      ...config.mapperConfig,
    };
    this.mapping = createSessionMapper(mapperConfig);

    // 启动自动清理
    if (this.config.enableAutoCleanup) {
      this.startCleanupTimer();
    }
  }

  // --------------------------------------------------------------------------
  // 会话操作
  // --------------------------------------------------------------------------

  /**
   * 创建新会话
   *
   * 如果提供了 platform 和 channelId，会自动创建映射
   */
  create(options: SessionCreateOptions = {}): Session {
    const id = this.generateId();
    const now = new Date();

    const session: Session = {
      id,
      channelId: options.channelId,
      platform: options.platform,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      status: "active",
      metadata: options.metadata,
    };

    this.sessions.set(id, session);
    this.emit("session:created", { session });

    // 自动创建跨渠道映射
    if (options.platform && options.channelId) {
      const chatId = this.extractChatId(options.channelId);
      if (chatId) {
        this.mapping.createMapping(options.platform, chatId, id, options.metadata);
      }
    }

    return session;
  }

  /**
   * 根据 ID 获取会话
   */
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /**
   * 根据渠道 ID 获取会话
   */
  getByChannelId(channelId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.channelId === channelId) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * 通过平台和聊天 ID 获取会话
   *
   * 使用跨渠道映射查找
   */
  getByChannel(platform: Platform, chatId: string): Session | undefined {
    const mapping = this.mapping.findByChannel(platform, chatId);
    if (mapping) {
      return this.sessions.get(mapping.sessionId);
    }

    // 回退到直接查找
    const channelId = `${platform}:${chatId}`;
    return this.getByChannelId(channelId);
  }

  /**
   * 获取或创建会话
   *
   * 如果提供了 channelId 且存在对应会话，返回该会话；否则创建新会话
   */
  getOrCreate(channelId?: string, options: SessionCreateOptions = {}): Session {
    if (channelId) {
      // 先尝试通过映射查找
      if (options.platform) {
        const chatId = this.extractChatId(channelId);
        if (chatId) {
          const found = this.getByChannel(options.platform, chatId);
          if (found) {
            return found;
          }
        }
      }

      // 回退到直接查找
      const existing = this.getByChannelId(channelId);
      if (existing) {
        return existing;
      }
    }

    return this.create(channelId ? { ...options, channelId } : options);
  }

  /**
   * 更新会话
   */
  update(id: string, updates: SessionUpdateOptions): Session {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    const updated: Session = {
      ...session,
      ...updates,
      updatedAt: new Date(),
    };

    this.sessions.set(id, updated);
    this.emit("session:updated", { session: updated, changes: updates });

    // 同步更新映射的活跃时间
    if (session.platform && session.channelId) {
      const chatId = this.extractChatId(session.channelId);
      if (chatId) {
        this.mapping.touch(session.platform, chatId);
      }
    }

    return updated;
  }

  /**
   * 增加消息计数
   */
  incrementMessageCount(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.messageCount++;
      session.updatedAt = new Date();

      // 同步更新映射的活跃时间
      if (session.platform && session.channelId) {
        const chatId = this.extractChatId(session.channelId);
        if (chatId) {
          this.mapping.touch(session.platform, chatId);
        }
      }
    }
  }

  /**
   * 关闭会话
   */
  close(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.status = "closed";
      session.updatedAt = new Date();
      this.emit("session:closed", { session });
    }
  }

  /**
   * 删除会话
   *
   * 同时删除关联的映射
   */
  delete(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      this.sessions.delete(id);
      this.emit("session:deleted", { sessionId: id });

      // 删除关联的映射
      if (session.platform && session.channelId) {
        const chatId = this.extractChatId(session.channelId);
        if (chatId) {
          this.mapping.deleteByChannel(session.platform, chatId);
        }
      }

      return true;
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // 查询方法
  // --------------------------------------------------------------------------

  /**
   * 获取所有会话
   */
  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 获取所有会话（别名方法）
   */
  getAll(): Session[] {
    return this.list();
  }

  /**
   * 获取活跃会话
   */
  listActive(): Session[] {
    return this.list().filter((s) => s.status === "active");
  }

  /**
   * 获取指定平台的会话
   */
  listByPlatform(platform: Platform): Session[] {
    return this.list().filter((s) => s.platform === platform);
  }

  /**
   * 获取指定平台的会话（别名方法）
   */
  getByPlatform(platform: Platform): Session[] {
    return this.listByPlatform(platform);
  }

  /**
   * 获取统计信息
   */
  getStats(): { total: number; byPlatform: Record<string, number> } {
    const byPlatform: Record<string, number> = {};
    for (const session of this.sessions.values()) {
      const platform = session.platform ?? "unknown";
      byPlatform[platform] = (byPlatform[platform] ?? 0) + 1;
    }
    return { total: this.sessions.size, byPlatform };
  }

  /**
   * 获取会话数量
   */
  get size(): number {
    return this.sessions.size;
  }

  // --------------------------------------------------------------------------
  // 过期与清理
  // --------------------------------------------------------------------------

  /**
   * 检查会话是否过期
   */
  isExpired(session: Session): boolean {
    const now = Date.now();
    const lastActive = session.updatedAt.getTime();
    return now - lastActive > this.config.sessionTTL;
  }

  /**
   * 清理过期的会话
   *
   * @param maxAge 可选的最大存活时间（毫秒），覆盖默认 TTL
   * @returns 清理的会话数量
   */
  cleanupExpired(maxAge?: number): number {
    const ttl = maxAge ?? this.config.sessionTTL;
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [id, session] of this.sessions) {
      const lastActive = session.updatedAt.getTime();
      if (now - lastActive > ttl || session.status === "closed") {
        expiredIds.push(id);
      }
    }

    for (const id of expiredIds) {
      const session = this.sessions.get(id);
      if (session) {
        this.sessions.delete(id);
        this.emit("session:expired", { session });

        // 删除关联的映射
        if (session.platform && session.channelId) {
          const chatId = this.extractChatId(session.channelId);
          if (chatId) {
            this.mapping.deleteByChannel(session.platform, chatId);
          }
        }
      }
    }

    // 同步清理映射
    const mappingExpired = this.mapping.cleanup(maxAge);

    const totalExpired = expiredIds.length + mappingExpired;
    if (totalExpired > 0) {
      this.emit("cleanup:completed", { expiredCount: totalExpired });
    }

    return totalExpired;
  }

  /**
   * 清除所有会话和映射
   */
  clear(): void {
    this.sessions.clear();
    this.mapping.clear();
  }

  // --------------------------------------------------------------------------
  // 生命周期
  // --------------------------------------------------------------------------

  /**
   * 启动自动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.config.cleanupInterval);

    // 防止定时器阻止进程退出
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * 停止自动清理定时器
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * 销毁实例
   */
  destroy(): void {
    this.stopCleanupTimer();
    this.sessions.clear();
    this.mapping.destroy();
    this.removeAllListeners();
  }

  // --------------------------------------------------------------------------
  // 工具方法
  // --------------------------------------------------------------------------

  /**
   * 生成会话 ID
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 9);
    return `session_${timestamp}_${random}`;
  }

  /**
   * 从 channelId 提取 chatId
   *
   * channelId 格式: {platform}:{chatId}
   */
  private extractChatId(channelId: string): string | undefined {
    const parts = channelId.split(":");
    if (parts.length >= 2) {
      return parts.slice(1).join(":");
    }
    return undefined;
  }
}

// ============================================================================
// 便捷工厂函数
// ============================================================================

/**
 * 创建 SessionManager 实例
 */
export function createSessionManager(config?: SessionManagerConfig): SessionManager {
  return new SessionManager(config);
}