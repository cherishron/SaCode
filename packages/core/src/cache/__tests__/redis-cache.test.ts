/**
 * RedisCache 测试
 * 测试 Redis 缓存实现
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RedisCache, createRedisCache } from "../redis";

// Mock ioredis
vi.mock("ioredis", () => {
  const mockRedis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    setex: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(-1),
    expire: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
    flushdb: vi.fn().mockResolvedValue("OK"),
    disconnect: vi.fn(),
    on: vi.fn(),
  };

  return {
    default: vi.fn().mockImplementation(() => mockRedis),
  };
});

describe("RedisCache", () => {
  let cache: RedisCache<string>;

  beforeEach(() => {
    cache = createRedisCache<string>({
      url: "redis://localhost:6379",
    });
  });

  afterEach(async () => {
    await cache.clear();
  });

  describe("初始化", () => {
    it("应该创建 RedisCache 实例", () => {
      expect(cache).toBeDefined();
      expect(cache).toBeInstanceOf(RedisCache);
    });

    it("应该使用自定义配置", () => {
      const customCache = new RedisCache<string>({
        url: "redis://localhost:6379",
        keyPrefix: "custom:",
        defaultTTL: 3600,
      });

      expect(customCache).toBeDefined();
    });
  });

  describe("基本操作", () => {
    it("应该设置和获取缓存值", async () => {
      const mockGet = vi.fn().mockResolvedValueOnce("value1");
      (cache as any).redis.get = mockGet;

      await cache.set("key1", "value1");
      const value = await cache.get("key1");

      expect(value).toBe("value1");
    });

    it("应该返回 undefined 对于不存在的键", async () => {
      const mockGet = vi.fn().mockResolvedValue(null);
      (cache as any).redis.get = mockGet;

      const value = await cache.get("non-existent");
      expect(value).toBeUndefined();
    });

    it("应该删除缓存值", async () => {
      const mockDel = vi.fn().mockResolvedValue(1);
      (cache as any).redis.del = mockDel;

      const deleted = await cache.delete("key1");
      expect(deleted).toBe(true);
    });

    it("应该检查键是否存在", async () => {
      const mockExists = vi.fn().mockResolvedValue(1);
      (cache as any).redis.exists = mockExists;

      const exists = await cache.has("key1");
      expect(exists).toBe(true);
    });

    it("应该清空所有缓存", async () => {
      const mockFlush = vi.fn().mockResolvedValue("OK");
      (cache as any).redis.flushdb = mockFlush;

      await cache.clear();
      expect(mockFlush).toHaveBeenCalled();
    });

    it("应该获取所有键", async () => {
      const mockKeys = vi.fn().mockResolvedValue(["key1", "key2", "key3"]);
      (cache as any).redis.keys = mockKeys;

      const keys = await cache.keys();
      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
      expect(keys).toContain("key3");
    });

    it("应该使用通配符过滤键", async () => {
      const mockKeys = vi.fn().mockResolvedValue(["user:1", "user:2", "post:1"]);
      (cache as any).redis.keys = mockKeys;

      const userKeys = await cache.keys("user:*");
      expect(userKeys).toHaveLength(2);
    });
  });

  describe("TTL 操作", () => {
    it("应该设置带 TTL 的缓存", async () => {
      const mockSetex = vi.fn().mockResolvedValue("OK");
      (cache as any).redis.setex = mockSetex;

      await cache.set("key1", "value1", 1000);
      expect(mockSetex).toHaveBeenCalled();
    });

    it("应该获取 TTL", async () => {
      const mockTtl = vi.fn().mockResolvedValue(500);
      (cache as any).redis.ttl = mockTtl;

      const ttl = await cache.getTTL("key1");
      expect(ttl).toBe(500);
    });

    it("应该返回 -2 对于不存在的键", async () => {
      const mockTtl = vi.fn().mockResolvedValue(-2);
      (cache as any).redis.ttl = mockTtl;

      const ttl = await cache.getTTL("non-existent");
      expect(ttl).toBeUndefined();
    });

    it("应该设置 TTL", async () => {
      const mockExpire = vi.fn().mockResolvedValue(1);
      (cache as any).redis.expire = mockExpire;

      const result = await cache.setTTL("key1", 5000);
      expect(result).toBe(true);
    });

    it("应该返回 false 对于不存在的键设置 TTL", async () => {
      const mockExpire = vi.fn().mockResolvedValue(0);
      (cache as any).redis.expire = mockExpire;

      const result = await cache.setTTL("non-existent", 5000);
      expect(result).toBe(false);
    });
  });

  describe("统计信息", () => {
    it("应该获取统计信息", async () => {
      const mockKeys = vi.fn().mockResolvedValue(["key1", "key2", "key3"]);
      (cache as any).redis.keys = mockKeys;

      const stats = await cache.stats();
      expect(stats.size).toBe(3);
    });
  });

  describe("键前缀", () => {
    it("应该使用自定义键前缀", async () => {
      const prefixedCache = createRedisCache<string>({
        url: "redis://localhost:6379",
        keyPrefix: "test:",
      });

      const mockSet = vi.fn().mockResolvedValue("OK");
      (prefixedCache as any).redis.set = mockSet;

      await prefixedCache.set("key1", "value1");

      expect(mockSet).toHaveBeenCalledWith("test:key1", "value1", expect.anything());
    });

    it("应该移除前缀返回原始键", async () => {
      const prefixedCache = createRedisCache<string>({
        url: "redis://localhost:6379",
        keyPrefix: "test:",
      });

      const mockKeys = vi.fn().mockResolvedValue(["test:key1", "test:key2"]);
      (prefixedCache as any).redis.keys = mockKeys;

      const keys = await prefixedCache.keys();
      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
    });
  });

  describe("序列化", () => {
    it("应该序列化复杂对象", async () => {
      const mockSet = vi.fn().mockResolvedValue("OK");
      (cache as any).redis.set = mockSet;

      const obj = { name: "test", value: 123, nested: { a: 1 } };
      await cache.set("obj", obj);

      expect(mockSet).toHaveBeenCalled();
      const serialized = mockSet.mock.calls[0][1];
      expect(JSON.parse(serialized)).toEqual(obj);
    });

    it("应该反序列化复杂对象", async () => {
      const obj = { name: "test", value: 123 };
      const mockGet = vi.fn().mockResolvedValue(JSON.stringify(obj));
      (cache as any).redis.get = mockGet;

      const value = await cache.get("obj");
      expect(value).toEqual(obj);
    });

    it("应该处理 undefined", async () => {
      const mockGet = vi.fn().mockResolvedValue(null);
      (cache as any).redis.get = mockGet;

      const value = await cache.get("non-existent");
      expect(value).toBeUndefined();
    });
  });

  describe("错误处理", () => {
    it("应该处理 Redis 错误", async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error("Redis error"));
      (cache as any).redis.get = mockGet;

      await expect(cache.get("key1")).rejects.toThrow("Redis error");
    });

    it("应该发射 error 事件", async () => {
      const errorListener = vi.fn();
      cache.on("error", errorListener);

      const mockGet = vi.fn().mockRejectedValue(new Error("Redis error"));
      (cache as any).redis.get = mockGet;

      try {
        await cache.get("key1");
      } catch {
        // 忽略错误
      }

      expect(errorListener).toHaveBeenCalled();
    });
  });

  describe("销毁", () => {
    it("应该断开 Redis 连接", () => {
      const mockDisconnect = vi.fn();
      (cache as any).redis.disconnect = mockDisconnect;

      cache.destroy();

      expect(mockDisconnect).toHaveBeenCalled();
    });
  });
});

describe("createRedisCache", () => {
  it("应该创建 RedisCache 实例", () => {
    const cache = createRedisCache<string>({
      url: "redis://localhost:6379",
    });

    expect(cache).toBeDefined();
    expect(cache).toBeInstanceOf(RedisCache);
  });

  it("应该使用默认配置", () => {
    const cache = createRedisCache({
      url: "redis://localhost:6379",
    });

    expect(cache).toBeDefined();
  });
});
