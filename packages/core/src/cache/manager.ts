/**
 * 缓存管理器
 * 
 * 提供统一的缓存接口，支持内存缓存和 Redis 缓存
 */

import { EventEmitter } from "eventemitter3";
import { MemoryCache, createMemoryCache } from "./memory.js";
import { createRedisCache } from "./redis.js";
import type {
  CacheConfig,
  CacheOptions,
  CacheBackend,
  CacheStats,
  CacheEvent,
} from "./types.js";

/**
 * 缓存管理器内部配置
 */
interface InternalConfig {
  backend: CacheConfig["backend"];
  defaultTTL: number;
  keyPrefix: string;
  redis?: CacheConfig["redis"];
  memory?: CacheConfig["memory"];
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: InternalConfig = {
  backend: "memory",
  defaultTTL: 0, // 永不过期
  keyPrefix: "saclaw:",
};

/**
 * 缓存管理器
 */
export class CacheManager<T = unknown> extends EventEmitter<{
  event: (event: CacheEvent<T>) => void;
}> {
  private config: InternalConfig;
  private backend: CacheBackend<T>;
  private hits = 0;
  private misses = 0;

  constructor(config: CacheConfig) {
    super();
    this.config = {
      backend: config.backend ?? DEFAULT_CONFIG.backend,
      defaultTTL: config.defaultTTL ?? DEFAULT_CONFIG.defaultTTL,
      keyPrefix: config.keyPrefix ?? DEFAULT_CONFIG.keyPrefix,
      redis: config.redis,
      memory: config.memory,
    };
    this.backend = this.createBackend();
  }

  /**
   * 获取缓存值
   */
  async get(key: string, options?: CacheOptions): Promise<T | undefined> {
    const fullKey = this.buildKey(key, options);

    try {
      const value = await this.backend.get(fullKey);

      if (value !== undefined) {
        this.hits++;
        this.emitEvent("get", key, value);
        return value;
      }

      this.misses++;
      this.emitEvent("get", key, undefined);
      return undefined;
    } catch (error) {
      this.emitEvent("error", key, undefined, error as Error);
      throw error;
    }
  }

  /**
   * 设置缓存值
   */
  async set(
    key: string,
    value: T,
    options?: CacheOptions
  ): Promise<void> {
    const fullKey = this.buildKey(key, options);
    const ttl = options?.ttl ?? this.config.defaultTTL;

    try {
      await this.backend.set(fullKey, value, ttl && ttl > 0 ? ttl : undefined);
      this.emitEvent("set", key, value);
    } catch (error) {
      this.emitEvent("error", key, value, error as Error);
      throw error;
    }
  }

  /**
   * 获取或设置缓存值
   * 如果缓存不存在，调用 factory 函数获取值并缓存
   */
  async getOrSet(
    key: string,
    factory: () => Promise<T>,
    options?: CacheOptions
  ): Promise<T> {
    const cached = await this.get(key, options);

    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, options);
    return value;
  }

  /**
   * 删除缓存值
   */
  async delete(key: string, options?: CacheOptions): Promise<boolean> {
    const fullKey = this.buildKey(key, options);

    try {
      const result = await this.backend.delete(fullKey);
      this.emitEvent("delete", key);
      return result;
    } catch (error) {
      this.emitEvent("error", key, undefined, error as Error);
      throw error;
    }
  }

  /**
   * 检查缓存是否存在
   */
  async has(key: string, options?: CacheOptions): Promise<boolean> {
    const fullKey = this.buildKey(key, options);
    return this.backend.has(fullKey);
  }

  /**
   * 获取 TTL
   */
  async getTTL(key: string, options?: CacheOptions): Promise<number | undefined> {
    const fullKey = this.buildKey(key, options);
    return this.backend.getTTL(fullKey);
  }

  /**
   * 设置 TTL
   */
  async setTTL(key: string, ttl: number, options?: CacheOptions): Promise<boolean> {
    const fullKey = this.buildKey(key, options);
    return this.backend.setTTL(fullKey, ttl);
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    await this.backend.clear();
    this.emitEvent("clear");
  }

  /**
   * 获取所有键
   */
  async keys(pattern?: string): Promise<string[]> {
    return this.backend.keys(pattern);
  }

  /**
   * 获取统计信息
   */
  async stats(): Promise<CacheStats> {
    const backendStats = await this.backend.stats();

    return {
      ...backendStats,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 
        ? this.hits / (this.hits + this.misses) 
        : 0,
      totalRequests: this.hits + this.misses,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 连接 (仅 Redis)
   */
  async connect(): Promise<void> {
    if (this.backend.connect) {
      await this.backend.connect();
      this.emitEvent("connect");
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.backend.disconnect) {
      await this.backend.disconnect();
      this.emitEvent("disconnect");
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.backend.isConnected?.() ?? true;
  }

  /**
   * 获取底层后端
   */
  getBackend(): CacheBackend<T> {
    return this.backend;
  }

  /**
   * 创建缓存后端
   */
  private createBackend(): CacheBackend<T> {
    switch (this.config.backend) {
      case "redis":
        if (!this.config.redis) {
          throw new Error("Redis config is required when using Redis backend");
        }
        return createRedisCache<T>(this.config.redis);

      case "memory":
      default:
        return createMemoryCache<T>(this.config.memory);
    }
  }

  /**
   * 构建完整键
   */
  private buildKey(key: string, options?: CacheOptions): string {
    const prefix = options?.prefix ?? this.config.keyPrefix;
    return prefix ? `${prefix}${key}` : key;
  }

  /**
   * 发送事件
   */
  private emitEvent(
    type: CacheEvent["type"],
    key?: string,
    value?: T,
    error?: Error
  ): void {
    const event: CacheEvent<T> = {
      type,
      key,
      value,
      error,
      timestamp: Date.now(),
    };

    this.emit("event", event);
  }
}

/**
 * 创建缓存管理器
 */
export function createCacheManager<T = unknown>(
  config: CacheConfig
): CacheManager<T> {
  return new CacheManager<T>(config);
}

// 重新导出 MemoryCache
export { MemoryCache, createMemoryCache };
