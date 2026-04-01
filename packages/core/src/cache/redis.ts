/**
 * Redis 缓存实现
 * 
 * 使用 ioredis 作为 Redis 客户端
 */

import { EventEmitter } from "eventemitter3";
import type {
  CacheBackend,
  CacheStats,
  RedisConfig,
} from "./types.js";

// Redis 客户端接口
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<"OK" | null>;
  setex(key: string, seconds: number, value: string): Promise<"OK">;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  ttl(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  ping(): Promise<"PONG">;
  quit(): Promise<"OK">;
  on(event: "error" | "connect" | "close" | "ready", listener: (...args: unknown[]) => void): this;
  status: string;
}

/**
 * Redis 缓存
 */
export class RedisCache<T = unknown>
  extends EventEmitter<{
    error: (error: Error) => void;
    connect: () => void;
    disconnect: () => void;
  }>
  implements CacheBackend<T>
{
  private config: RedisConfig;
  private client: RedisClient | null = null;
  private keyPrefix: string;
  private connected = false;

  constructor(config: RedisConfig) {
    super();
    this.config = config;
    this.keyPrefix = config.keyPrefix || "SACODE:";
  }

  /**
   * 连接 Redis
   */
  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    try {
      // 动态加载 ioredis
      const ioredis = await this.loadIORedis();
      
      if (!ioredis) {
        throw new Error(
          "ioredis package not installed. Run: pnpm add ioredis"
        );
      }

      // 构建 Redis 连接选项
      const options: Record<string, unknown> = {
        keyPrefix: this.keyPrefix,
        connectTimeout: this.config.connectTimeout || 10000,
        maxRetriesPerRequest: this.config.maxRetries ?? 3,
        lazyConnect: true,
      };

      // 如果提供了 URL，使用 URL 连接
      if (this.config.url) {
        this.client = new ioredis(this.config.url, options) as RedisClient;
      } else {
        this.client = new ioredis({
          host: this.config.host || "localhost",
          port: this.config.port || 6379,
          password: this.config.password,
          db: this.config.db || 0,
          ...options,
        }) as RedisClient;
      }

      // 设置事件监听
      this.client.on("connect", () => {
        this.connected = true;
        this.emit("connect");
      });

      this.client.on("close", () => {
        this.connected = false;
        this.emit("disconnect");
      });

      this.client.on("error", (err: unknown) => {
        this.emit("error", err as Error);
      });

      // 执行连接
      await this.client.ping();
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  /**
   * 动态加载 ioredis
   */
  private async loadIORedis(): Promise<(new (...args: unknown[]) => RedisClient) | null> {
    try {
      // ioredis 是可选依赖，使用动态导入
      // @ts-expect-error - ioredis 是可选依赖，可能未安装
      const module = await import("ioredis");
      if (module && typeof module.default === "function") {
        return module.default as new (...args: unknown[]) => RedisClient;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected && this.client?.status === "ready";
  }

  async get(key: string): Promise<T | undefined> {
    this.ensureConnected();

    const value = await this.client!.get(this.addPrefix(key));

    if (!value) {
      return undefined;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    this.ensureConnected();

    const serialized = JSON.stringify(value);
    const fullKey = this.addPrefix(key);

    if (ttl && ttl > 0) {
      // 使用 SETEX 设置带过期时间的值
      await this.client!.setex(fullKey, Math.ceil(ttl / 1000), serialized);
    } else {
      await this.client!.set(fullKey, serialized);
    }
  }

  async delete(key: string): Promise<boolean> {
    this.ensureConnected();

    const result = await this.client!.del(this.addPrefix(key));
    return result > 0;
  }

  async has(key: string): Promise<boolean> {
    this.ensureConnected();

    const result = await this.client!.exists(this.addPrefix(key));
    return result === 1;
  }

  async getTTL(key: string): Promise<number | undefined> {
    this.ensureConnected();

    const ttl = await this.client!.ttl(this.addPrefix(key));

    // -2: 键不存在
    // -1: 键没有过期时间
    if (ttl < 0) {
      return undefined;
    }

    return ttl * 1000; // 转换为毫秒
  }

  async setTTL(key: string, ttl: number): Promise<boolean> {
    this.ensureConnected();

    const result = await this.client!.expire(
      this.addPrefix(key),
      Math.ceil(ttl / 1000)
    );
    return result === 1;
  }

  async clear(): Promise<void> {
    this.ensureConnected();

    // 使用 KEYS 获取所有匹配前缀的键
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.client!.keys(pattern);

    if (keys.length > 0) {
      await this.client!.del(...keys);
    }
  }

  async keys(pattern?: string): Promise<string[]> {
    this.ensureConnected();

    const searchPattern = pattern
      ? `${this.keyPrefix}${pattern}`
      : `${this.keyPrefix}*`;

    const allKeys = await this.client!.keys(searchPattern);
    return allKeys.map((key) => this.removePrefix(key));
  }

  async stats(): Promise<CacheStats> {
    this.ensureConnected();

    const keys = await this.keys();
    const keyCount = keys.length;

    return {
      keys: keyCount,
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalRequests: 0,
      connected: this.connected,
    };
  }

  /**
   * 添加键前缀
   */
  private addPrefix(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /**
   * 移除键前缀
   */
  private removePrefix(key: string): string {
    return key.startsWith(this.keyPrefix)
      ? key.slice(this.keyPrefix.length)
      : key;
  }

  /**
   * 确保已连接
   */
  private ensureConnected(): void {
    if (!this.client || !this.connected) {
      throw new Error("Redis cache not connected. Call connect() first.");
    }
  }
}

/**
 * 创建 Redis 缓存
 */
export function createRedisCache<T = unknown>(config: RedisConfig): RedisCache<T> {
  return new RedisCache<T>(config);
}