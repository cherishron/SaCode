/**
 * 跨渠道会话映射管理
 *
 * 提供跨平台渠道到会话的映射能力，支持：
 * - 多平台渠道标识 (telegram, wechat, discord 等)
 * - 持久化存储 (JSON 文件)
 * - TTL 过期机制
 * - 自动清理任务
 *
 * @module session/mapping
 */

import EventEmitter from "eventemitter3";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ChannelIdentifier,
  Platform,
  SessionMappingEntry,
  SessionMapperConfig,
  SessionMapperEvents,
} from "./types";

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_CONFIG: Required<Omit<SessionMapperConfig, "persistPath">> & {
  persistPath: string;
} = {
  persistPath: join(homedir(), ".SACODE", "session_mappings.json"),
  enablePersistence: true,
  sessionTTL: 24 * 60 * 60 * 1000, // 24 小时
  cleanupInterval: 60 * 60 * 1000, // 1 小时
  enableAutoCleanup: true,
};

// ============================================================================
// SessionMapper - 跨渠道会话映射器
// ============================================================================

/**
 * 会话映射器 - 管理跨渠道的会话映射
 *
 * @example
 * ```typescript
 * const mapper = new SessionMapper();
 *
 * // 创建映射
 * const sessionId = mapper.createMapping("telegram", "123456789");
 *
 * // 查找映射
 * const found = mapper.findByChannel("telegram", "123456789");
 *
 * // 更新活跃时间
 * mapper.touch("telegram", "123456789");
 *
 * // 删除映射
 * mapper.deleteByChannel("telegram", "123456789");
 * ```
 */
export class SessionMapper extends EventEmitter<SessionMapperEvents> {
  private mappings: Map<ChannelIdentifier, SessionMappingEntry> = new Map();
  private config: Required<SessionMapperConfig>;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(config: SessionMapperConfig = {}) {
    super();

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      persistPath: config.persistPath ?? DEFAULT_CONFIG.persistPath,
    };

    // 恢复持久化的映射
    if (this.config.enablePersistence) {
      this.restore();
    }

    // 启动自动清理
    if (this.config.enableAutoCleanup) {
      this.startCleanupTimer();
    }
  }

  // --------------------------------------------------------------------------
  // 映射操作
  // --------------------------------------------------------------------------

  /**
   * 创建渠道到会话的映射
   *
   * @param platform 平台名称 (如 telegram, wechat, discord)
   * @param chatId 聊天 ID
   * @param sessionId 可选的会话 ID，不提供则自动生成
   * @param metadata 可选的元数据
   * @returns 会话 ID
   */
  createMapping(
    platform: Platform,
    chatId: string,
    sessionId?: string,
    metadata?: Record<string, unknown>
  ): string {
    const channel = this.buildChannelIdentifier(platform, chatId);
    const now = new Date();

    const entry: SessionMappingEntry = {
      channel,
      sessionId: sessionId ?? this.generateSessionId(),
      platform,
      chatId,
      createdAt: now,
      lastActiveAt: now,
      metadata,
    };

    this.mappings.set(channel, entry);
    this.emit("mapping:created", { channel, sessionId: entry.sessionId });

    // 异步持久化
    this.schedulePersist();

    return entry.sessionId;
  }

  /**
   * 根据渠道查找映射
   *
   * @param platform 平台名称
   * @param chatId 聊天 ID
   * @returns 映射条目或 undefined
   */
  findByChannel(platform: Platform, chatId: string): SessionMappingEntry | undefined {
    const channel = this.buildChannelIdentifier(platform, chatId);
    return this.mappings.get(channel);
  }

  /**
   * 根据渠道获取映射（别名方法）
   */
  getMapping(platform: Platform, chatId: string): SessionMappingEntry | undefined {
    return this.findByChannel(platform, chatId);
  }

  /**
   * 根据会话 ID 查找映射
   *
   * @param sessionId 会话 ID
   * @returns 映射条目或 undefined
   */
  findBySessionId(sessionId: string): SessionMappingEntry | undefined {
    for (const entry of this.mappings.values()) {
      if (entry.sessionId === sessionId) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * 根据会话 ID 获取映射（别名方法，返回渠道标识符数组）
   */
  getBySessionId(sessionId: string): SessionMappingEntry[] {
    const results: SessionMappingEntry[] = [];
    for (const entry of this.mappings.values()) {
      if (entry.sessionId === sessionId) {
        results.push(entry);
      }
    }
    return results;
  }

  /**
   * 设置映射（更新或创建）
   *
   * @param platform 平台名称
   * @param chatId 聊天 ID
   * @param sessionId 会话 ID
   * @param metadata 可选的元数据
   * @returns 会话 ID
   */
  setMapping(
    platform: Platform,
    chatId: string,
    sessionId: string,
    metadata?: Record<string, unknown>
  ): string {
    const existing = this.findByChannel(platform, chatId);

    if (existing) {
      // 更新现有映射
      const channel = this.buildChannelIdentifier(platform, chatId);
      const entry: SessionMappingEntry = {
        ...existing,
        sessionId,
        lastActiveAt: new Date(),
        metadata: metadata ?? existing.metadata,
      };
      this.mappings.set(channel, entry);
      this.emit("mapping:updated", { channel, sessionId });
      this.schedulePersist();
      return sessionId;
    }

    // 创建新映射
    return this.createMapping(platform, chatId, sessionId, metadata);
  }

  /**
   * 获取或创建映射
   *
   * 如果映射存在且未过期，返回现有映射；否则创建新映射
   */
  getOrCreate(
    platform: Platform,
    chatId: string,
    metadata?: Record<string, unknown>
  ): { sessionId: string; isNew: boolean } {
    const existing = this.findByChannel(platform, chatId);

    if (existing && !this.isExpired(existing)) {
      // 更新活跃时间
      this.touch(platform, chatId);
      return { sessionId: existing.sessionId, isNew: false };
    }

    // 创建新映射
    const sessionId = this.createMapping(platform, chatId, undefined, metadata);
    return { sessionId, isNew: true };
  }

  /**
   * 更新渠道的最后活跃时间
   */
  touch(platform: Platform, chatId: string): void {
    const channel = this.buildChannelIdentifier(platform, chatId);
    const entry = this.mappings.get(channel);

    if (entry) {
      entry.lastActiveAt = new Date();
      this.emit("mapping:updated", { channel, sessionId: entry.sessionId });
      this.schedulePersist();
    }
  }

  /**
   * 删除指定渠道的映射
   */
  deleteMapping(platform: Platform, chatId: string): boolean {
    return this.deleteByChannel(platform, chatId);
  }

  /**
   * 删除指定渠道的映射
   */
  deleteByChannel(platform: Platform, chatId: string): boolean {
    const channel = this.buildChannelIdentifier(platform, chatId);
    const entry = this.mappings.get(channel);

    if (entry) {
      this.mappings.delete(channel);
      this.emit("mapping:deleted", { channel, sessionId: entry.sessionId });
      this.schedulePersist();
      return true;
    }

    return false;
  }

  /**
   * 根据会话 ID 删除映射
   */
  deleteBySessionId(sessionId: string): number {
    let count = 0;

    for (const entry of this.mappings.values()) {
      if (entry.sessionId === sessionId) {
        this.mappings.delete(entry.channel);
        this.emit("mapping:deleted", { channel: entry.channel, sessionId });
        count++;
      }
    }

    if (count > 0) {
      this.schedulePersist();
    }

    return count;
  }

  /**
   * 获取所有映射
   */
  getAll(): SessionMappingEntry[] {
    return Array.from(this.mappings.values());
  }

  /**
   * 获取指定平台的所有映射
   */
  getByPlatform(platform: Platform): SessionMappingEntry[] {
    return this.getAll().filter((entry) => entry.platform === platform);
  }

  /**
   * 获取映射数量
   */
  get size(): number {
    return this.mappings.size;
  }

  // --------------------------------------------------------------------------
  // 过期与清理
  // --------------------------------------------------------------------------

  /**
   * 检查映射是否过期
   */
  isExpired(entry: SessionMappingEntry): boolean {
    const now = Date.now();
    const lastActive = entry.lastActiveAt.getTime();
    return now - lastActive > this.config.sessionTTL;
  }

  /**
   * 清理过期的映射
   *
   * @param maxAge 可选的最大存活时间（毫秒），覆盖默认 TTL
   * @returns 清理的映射数量
   */
  cleanup(maxAge?: number): number {
    const ttl = maxAge ?? this.config.sessionTTL;
    const now = Date.now();
    const expiredChannels: ChannelIdentifier[] = [];

    for (const [channel, entry] of this.mappings) {
      const lastActive = entry.lastActiveAt.getTime();
      if (now - lastActive > ttl) {
        expiredChannels.push(channel);
      }
    }

    for (const channel of expiredChannels) {
      const entry = this.mappings.get(channel);
      if (entry) {
        this.mappings.delete(channel);
        this.emit("mapping:expired", { channel, sessionId: entry.sessionId });
      }
    }

    if (expiredChannels.length > 0) {
      this.emit("cleanup:completed", { expiredCount: expiredChannels.length });
      this.schedulePersist();
    }

    return expiredChannels.length;
  }

  /**
   * 清除所有映射
   */
  clear(): void {
    this.mappings.clear();
    this.schedulePersist();
  }

  // --------------------------------------------------------------------------
  // 持久化
  // --------------------------------------------------------------------------

  private persistPending = false;

  /**
   * 调度持久化任务（防抖）
   */
  private schedulePersist(): void {
    if (!this.config.enablePersistence || this.persistPending) {
      return;
    }

    this.persistPending = true;
    queueMicrotask(() => {
      this.persistPending = false;
      this.persist();
    });
  }

  /**
   * 手动保存映射到文件
   */
  persist(): void {
    if (!this.config.enablePersistence) {
      return;
    }

    try {
      const dirPath = join(this.config.persistPath, "..");
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }

      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        mappings: this.getAll().map((entry) => ({
          ...entry,
          createdAt: entry.createdAt.toISOString(),
          lastActiveAt: entry.lastActiveAt.toISOString(),
        })),
      };

      writeFileSync(this.config.persistPath, JSON.stringify(data, null, 2), "utf-8");
      this.emit("persistence:saved", { count: this.mappings.size });
    } catch (error) {
      console.error("[SessionMapper] Failed to persist mappings:", error);
    }
  }

  /**
   * 从文件恢复映射
   */
  restore(): void {
    if (!this.config.enablePersistence) {
      return;
    }

    try {
      if (!existsSync(this.config.persistPath)) {
        return;
      }

      const content = readFileSync(this.config.persistPath, "utf-8");
      const data = JSON.parse(content) as {
        version: number;
        updatedAt: string;
        mappings: Array<{
          channel: ChannelIdentifier;
          sessionId: string;
          platform: Platform;
          chatId: string;
          createdAt: string;
          lastActiveAt: string;
          metadata?: Record<string, unknown>;
        }>;
      };

      // 清除现有映射
      this.mappings.clear();

      // 恢复映射
      for (const item of data.mappings) {
        const entry: SessionMappingEntry = {
          channel: item.channel,
          sessionId: item.sessionId,
          platform: item.platform,
          chatId: item.chatId,
          createdAt: new Date(item.createdAt),
          lastActiveAt: new Date(item.lastActiveAt),
          metadata: item.metadata,
        };

        // 跳过已过期的映射
        if (!this.isExpired(entry)) {
          this.mappings.set(entry.channel, entry);
        }
      }

      this.emit("persistence:restored", { count: this.mappings.size });
    } catch (error) {
      console.error("[SessionMapper] Failed to restore mappings:", error);
    }
  }

  /**
   * 删除持久化文件
   */
  deletePersistenceFile(): void {
    if (existsSync(this.config.persistPath)) {
      unlinkSync(this.config.persistPath);
    }
  }

  // --------------------------------------------------------------------------
  // 生命周期
  // --------------------------------------------------------------------------

  /**
   * 启动自动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
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
   * 销毁实例，停止定时器并保存数据
   */
  destroy(): void {
    this.stopCleanupTimer();
    this.persist();
    this.removeAllListeners();
  }

  // --------------------------------------------------------------------------
  // 工具方法
  // --------------------------------------------------------------------------

  /**
   * 构建渠道标识符
   */
  private buildChannelIdentifier(platform: Platform, chatId: string): ChannelIdentifier {
    return `${platform}:${chatId}` as ChannelIdentifier;
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 9);
    return `session_${timestamp}_${random}`;
  }
}

// ============================================================================
// 便捷工厂函数
// ============================================================================

/**
 * 创建 SessionMapper 实例
 */
export function createSessionMapper(config?: SessionMapperConfig): SessionMapper {
  return new SessionMapper(config);
}
