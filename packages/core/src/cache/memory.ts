/**
 * 内存缓存实现
 */

import { EventEmitter } from "eventemitter3";
import type {
  CacheBackend,
  CacheEntry,
  CacheStats,
  MemoryCacheConfig,
} from "./types.js";

/**
 * 内存缓存内部配置
 */
interface InternalMemoryConfig {
  maxSize: number;
  cleanupInterval: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: InternalMemoryConfig = {
  maxSize: 10000,
  cleanupInterval: 60000, // 1 分钟
};

/**
 * 内存缓存
 */
export class MemoryCache<T = unknown>
  extends EventEmitter<{
    expire: (key: string, entry: CacheEntry<T>) => void;
    evict: (key: string, entry: CacheEntry<T>) => void;
  }>
  implements CacheBackend<T>
{
  private cache: Map<string, CacheEntry<T>> = new Map();
  private config: InternalMemoryConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: MemoryCacheConfig) {
    super();
    this.config = {
      maxSize: config?.maxSize ?? DEFAULT_CONFIG.maxSize,
      cleanupInterval: config?.cleanupInterval ?? DEFAULT_CONFIG.cleanupInterval,
    };
    this.startCleanup();
  }

  async get(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // 检查是否过期
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.emit("expire", key, entry);
      return undefined;
    }

    // 更新访问信息
    entry.accessedAt = Date.now();
    entry.hits++;

    return entry.value;
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    // 检查是否需要淘汰
    if (this.cache.size >= this.config.maxSize) {
      this.evictLRU();
    }

    const now = Date.now();
    const expiresAt = ttl ? now + ttl : undefined;

    const entry: CacheEntry<T> = {
      key,
      value,
      expiresAt,
      createdAt: now,
      accessedAt: now,
      hits: 0,
    };

    this.cache.set(key, entry);
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // 检查是否过期
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.emit("expire", key, entry);
      return false;
    }

    return true;
  }

  async getTTL(key: string): Promise<number | undefined> {
    const entry = this.cache.get(key);

    if (!entry || !entry.expiresAt) {
      return undefined;
    }

    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? remaining : undefined;
  }

  async setTTL(key: string, ttl: number): Promise<boolean> {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    entry.expiresAt = Date.now() + ttl;
    return true;
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.cache.keys());

    if (!pattern) {
      return allKeys;
    }

    // 简单的通配符匹配
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return allKeys.filter((key) => regex.test(key));
  }

  async stats(): Promise<CacheStats> {
    let totalHits = 0;
    let totalMemory = 0;

    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
      // 估算内存使用
      totalMemory += estimateSize(entry.value);
    }

    return {
      keys: this.cache.size,
      hits: totalHits,
      misses: 0, // 内存缓存不跟踪未命中
      hitRate: 1, // 需要外部跟踪
      totalRequests: totalHits,
      memoryUsage: totalMemory,
    };
  }

  /**
   * 获取缓存大小
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * 清理过期条目
   */
  cleanup(): void {
    const now = Date.now();

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.cache.delete(key);
        this.emit("expire", key, entry);
      }
    }
  }

  /**
   * 销毁缓存
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }

  /**
   * 启动清理定时器
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * 淘汰最近最少使用的条目
   */
  private evictLRU(): void {
    let oldest: { key: string; accessedAt: number } | null = null;

    for (const [key, entry] of this.cache) {
      if (!oldest || entry.accessedAt < oldest.accessedAt) {
        oldest = { key, accessedAt: entry.accessedAt };
      }
    }

    if (oldest) {
      const entry = this.cache.get(oldest.key);
      if (entry) {
        this.cache.delete(oldest.key);
        this.emit("evict", oldest.key, entry);
      }
    }
  }
}

/**
 * 估算对象大小 (字节)
 */
function estimateSize(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }

  switch (typeof value) {
    case "number":
      return 8;
    case "string":
      return (value as string).length * 2;
    case "boolean":
      return 4;
    case "object":
      try {
        return JSON.stringify(value).length * 2;
      } catch {
        return 100; // 估算值
      }
    default:
      return 8;
  }
}

/**
 * 创建内存缓存
 */
export function createMemoryCache<T = unknown>(
  config?: MemoryCacheConfig
): MemoryCache<T> {
  return new MemoryCache<T>(config);
}
