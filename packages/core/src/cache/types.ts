/**
 * 缓存类型定义
 */

/**
 * 缓存后端类型
 */
export type CacheBackendType = "memory" | "redis";

/**
 * 缓存配置
 */
export interface CacheConfig {
  /** 缓存后端类型 */
  backend: CacheBackendType;
  /** 默认 TTL (毫秒)，0 表示永不过期 */
  defaultTTL?: number | undefined;
  /** 键前缀 */
  keyPrefix?: string | undefined;
  /** Redis 配置 (当 backend 为 redis 时必需) */
  redis?: RedisConfig | undefined;
  /** 内存缓存配置 */
  memory?: MemoryCacheConfig | undefined;
}

/**
 * Redis 配置
 */
export interface RedisConfig {
  /** Redis URL */
  url?: string | undefined;
  /** 主机名 */
  host?: string | undefined;
  /** 端口 */
  port?: number | undefined;
  /** 密码 */
  password?: string | undefined;
  /** 数据库 */
  db?: number | undefined;
  /** 键前缀 */
  keyPrefix?: string | undefined;
  /** 连接超时 (毫秒) */
  connectTimeout?: number | undefined;
  /** 最大重试次数 */
  maxRetries?: number | undefined;
}

/**
 * 内存缓存配置
 */
export interface MemoryCacheConfig {
  /** 最大条目数 */
  maxSize?: number | undefined;
  /** 清理间隔 (毫秒) */
  cleanupInterval?: number | undefined;
}

/**
 * 缓存选项 (单次操作)
 */
export interface CacheOptions {
  /** TTL (毫秒)，覆盖默认值 */
  ttl?: number | undefined;
  /** 键前缀，覆盖默认值 */
  prefix?: string | undefined;
}

/**
 * 缓存条目
 */
export interface CacheEntry<T = unknown> {
  /** 键 */
  key: string;
  /** 值 */
  value: T;
  /** 过期时间戳 (毫秒) */
  expiresAt: number | undefined;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后访问时间戳 */
  accessedAt: number;
  /** 访问次数 */
  hits: number;
}

/**
 * 缓存统计
 */
export interface CacheStats {
  /** 总条目数 */
  keys: number;
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 命中率 */
  hitRate: number;
  /** 总读取次数 */
  totalRequests: number;
  /** 内存使用 (字节，仅内存缓存) */
  memoryUsage?: number | undefined;
  /** 连接状态 (仅 Redis) */
  connected?: boolean | undefined;
}

/**
 * 缓存事件类型
 */
export type CacheEventType = 
  | "set"
  | "get"
  | "delete"
  | "expire"
  | "clear"
  | "error"
  | "connect"
  | "disconnect";

/**
 * 缓存事件
 */
export interface CacheEvent<T = unknown> {
  /** 事件类型 */
  type: CacheEventType;
  /** 键 */
  key?: string | undefined;
  /** 值 */
  value?: T | undefined;
  /** 错误 */
  error?: Error | undefined;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 缓存事件处理器
 */
export type CacheEventHandler<T = unknown> = (event: CacheEvent<T>) => void;

/**
 * 缓存后端接口
 */
export interface CacheBackend<T = unknown> {
  /** 获取值 */
  get(key: string): Promise<T | undefined>;
  /** 设置值 */
  set(key: string, value: T, ttl?: number): Promise<void>;
  /** 删除值 */
  delete(key: string): Promise<boolean>;
  /** 检查键是否存在 */
  has(key: string): Promise<boolean>;
  /** 获取 TTL */
  getTTL(key: string): Promise<number | undefined>;
  /** 设置 TTL */
  setTTL(key: string, ttl: number): Promise<boolean>;
  /** 清空所有缓存 */
  clear(): Promise<void>;
  /** 获取所有键 */
  keys(pattern?: string): Promise<string[]>;
  /** 获取统计信息 */
  stats(): Promise<CacheStats>;
  /** 连接 */
  connect?(): Promise<void>;
  /** 断开连接 */
  disconnect?(): Promise<void>;
  /** 是否已连接 */
  isConnected?(): boolean;
}
