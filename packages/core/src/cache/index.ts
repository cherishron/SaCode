/**
 * 缓存模块
 * 
 * 提供统一的缓存接口，支持内存缓存和 Redis 缓存
 */

export { CacheManager, createCacheManager, MemoryCache } from "./manager.js";
export { RedisCache, createRedisCache } from "./redis.js";
export type {
  CacheConfig,
  CacheOptions,
  CacheEntry,
  CacheStats,
  CacheBackend,
  CacheEvent,
  CacheEventHandler,
  CacheBackendType,
  RedisConfig,
  MemoryCacheConfig,
  CacheEventType,
} from "./types.js";
