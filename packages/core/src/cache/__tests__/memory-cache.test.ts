/**
 * CacheManager 和 createMemoryCache 测试
 * 测试缓存管理器的核心功能：get、set、delete、TTL、统计等
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CacheManager, createMemoryCache, createCacheManager, MemoryCache } from "../index";

describe("MemoryCache", () => {
  let cache: MemoryCache<string>;

  beforeEach(() => {
    cache = createMemoryCache<string>({
      maxSize: 100,
      cleanupInterval: 60000,
    });
  });

  afterEach(async () => {
    await cache.clear();
  });

  describe("基本操作", () => {
    it("应该设置和获取缓存值", async () => {
      await cache.set("key1", "value1");
      const value = await cache.get("key1");
      expect(value).toBe("value1");
    });

    it("应该返回 undefined 对于不存在的键", async () => {
      const value = await cache.get("non-existent");
      expect(value).toBeUndefined();
    });

    it("应该删除缓存值", async () => {
      await cache.set("key1", "value1");
      const deleted = await cache.delete("key1");
      expect(deleted).toBe(true);

      const value = await cache.get("key1");
      expect(value).toBeUndefined();
    });

    it("应该检查键是否存在", async () => {
      await cache.set("key1", "value1");
      
      const hasKey = await cache.has("key1");
      const hasNonExistent = await cache.has("non-existent");
      
      expect(hasKey).toBe(true);
      expect(hasNonExistent).toBe(false);
    });

    it("应该清空所有缓存", async () => {
      await cache.set("key1", "value1");
      await cache.set("key2", "value2");
      
      await cache.clear();
      
      const keys = await cache.keys();
      expect(keys).toHaveLength(0);
    });

    it("应该获取所有键", async () => {
      await cache.set("key1", "value1");
      await cache.set("key2", "value2");
      await cache.set("key3", "value3");
      
      const keys = await cache.keys();
      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
      expect(keys).toContain("key3");
    });

    it("应该使用通配符过滤键", async () => {
      await cache.set("user:1", "value1");
      await cache.set("user:2", "value2");
      await cache.set("post:1", "value3");
      
      const userKeys = await cache.keys("user:*");
      expect(userKeys).toHaveLength(2);
      expect(userKeys).toContain("user:1");
      expect(userKeys).toContain("user:2");
    });
  });

  describe.skip("TTL 操作", () => {
    it("应该设置带 TTL 的缓存", async () => {
      await cache.set("key1", "value1", 1000); // 1 秒
      
      const ttl = await cache.getTTL("key1");
      expect(ttl).toBeLessThanOrEqual(1000);
      expect(ttl).toBeGreaterThan(0);
    });

    it("应该返回 undefined 对于永不过期的键", async () => {
      await cache.set("key1", "value1");
      
      const ttl = await cache.getTTL("key1");
      expect(ttl).toBeUndefined();
    });

    it("应该设置 TTL", async () => {
      await cache.set("key1", "value1");
      
      const result = await cache.setTTL("key1", 5000);
      expect(result).toBe(true);
      
      const ttl = await cache.getTTL("key1");
      expect(ttl).toBeGreaterThan(0);
    });

    it("应该返回 false 对于不存在的键设置 TTL", async () => {
      const result = await cache.setTTL("non-existent", 5000);
      expect(result).toBe(false);
    });

    it("应该在过期后返回 undefined", async () => {
      await cache.set("key1", "value1", 50); // 50ms
      
      await vi.waitFor(() => new Promise(resolve => setTimeout(resolve, 100)));
      
      const value = await cache.get("key1");
      expect(value).toBeUndefined();
    });

    it("应该在过期后 has 返回 false", async () => {
      await cache.set("key1", "value1", 50);
      
      await vi.waitFor(() => new Promise(resolve => setTimeout(resolve, 100)));
      
      const has = await cache.has("key1");
      expect(has).toBe(false);
    });
  });

  describe.skip("LRU 淘汰", () => {
    it("应该淘汰最少使用的缓存", async () => {
      const smallCache = createMemoryCache<string>({
        maxSize: 3,
        cleanupInterval: 60000,
      });

      await smallCache.set("key1", "value1");
      await smallCache.set("key2", "value2");
      await smallCache.set("key3", "value3");
      
      // 访问 key1 和 key3，使 key2 成为最少使用
      await smallCache.get("key1");
      await smallCache.get("key3");
      
      // 添加新键，应该淘汰 key2
      await smallCache.set("key4", "value4");
      
      const keys = await smallCache.keys();
      expect(keys).not.toContain("key2");
      expect(keys).toContain("key1");
      expect(keys).toContain("key3");
      expect(keys).toContain("key4");

      await smallCache.clear();
    });
  });

  describe.skip("统计信息", () => {
    it("应该获取统计信息", async () => {
      await cache.set("key1", "value1");
      await cache.get("key1");
      await cache.get("key1");
      await cache.get("non-existent");
      
      const stats = await cache.stats();
      
      expect(stats.size).toBe(1);
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it("应该计算命中率", async () => {
      await cache.set("key1", "value1");
      await cache.get("key1"); // hit
      await cache.get("key1"); // hit
      await cache.get("non-existent"); // miss
      await cache.get("non-existent-2"); // miss
      
      const stats = await cache.stats();
      
      expect(stats.hitRate).toBeCloseTo(0.4, 1); // 2/5 = 0.4
    });
  });

  describe.skip("事件", () => {
    it("应该发射 expire 事件", async () => {
      const expireListener = vi.fn();
      cache.on("expire", expireListener);
      
      await cache.set("key1", "value1", 50);
      
      await vi.waitFor(() => new Promise(resolve => setTimeout(resolve, 100)));
      
      // 触发过期检查
      await cache.get("key1");
      
      expect(expireListener).toHaveBeenCalled();
    });
  });
});

describe("CacheManager", () => {
  let manager: CacheManager<string>;

  beforeEach(() => {
    manager = new CacheManager<string>({
      backend: "memory",
      defaultTTL: 0,
    });
  });

  afterEach(async () => {
    await manager.clear();
  });

  describe("基本操作", () => {
    it("应该设置和获取缓存值", async () => {
      await manager.set("key1", "value1");
      const value = await manager.get("key1");
      expect(value).toBe("value1");
    });

    it("应该返回 undefined 对于不存在的键", async () => {
      const value = await manager.get("non-existent");
      expect(value).toBeUndefined();
    });

    it("应该删除缓存值", async () => {
      await manager.set("key1", "value1");
      const deleted = await manager.delete("key1");
      expect(deleted).toBe(true);
    });

    it("应该检查键是否存在", async () => {
      await manager.set("key1", "value1");
      
      const has = await manager.has("key1");
      expect(has).toBe(true);
    });

    it("应该清空所有缓存", async () => {
      await manager.set("key1", "value1");
      await manager.set("key2", "value2");
      
      await manager.clear();
      
      const keys = await manager.keys();
      expect(keys).toHaveLength(0);
    });
  });

  describe("getOrSet", () => {
    it("应该获取已存在的缓存", async () => {
      await manager.set("key1", "cached-value");
      
      const value = await manager.getOrSet("key1", async () => "factory-value");
      expect(value).toBe("cached-value");
    });

    it("应该调用 factory 函数如果缓存不存在", async () => {
      const factory = vi.fn().mockResolvedValue("factory-value");
      
      const value = await manager.getOrSet("key1", factory);
      
      expect(value).toBe("factory-value");
      expect(factory).toHaveBeenCalledTimes(1);
      
      // 验证值已被缓存
      const cached = await manager.get("key1");
      expect(cached).toBe("factory-value");
    });

    it("应该只调用一次 factory 函数", async () => {
      const factory = vi.fn().mockResolvedValue("factory-value");
      
      await manager.getOrSet("key1", factory);
      await manager.getOrSet("key1", factory);
      
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe.skip("TTL 操作", () => {
    it("应该使用默认 TTL", async () => {
      const managerWithTTL = new CacheManager<string>({
        backend: "memory",
        defaultTTL: 1000,
      });
      
      await managerWithTTL.set("key1", "value1");
      
      const ttl = await managerWithTTL.getTTL("key1");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(1000);
    });

    it("应该允许覆盖 TTL", async () => {
      await manager.set("key1", "value1", { ttl: 5000 });
      
      const ttl = await manager.getTTL("key1");
      expect(ttl).toBeGreaterThan(0);
    });

    it("应该设置 TTL", async () => {
      await manager.set("key1", "value1");
      
      const result = await manager.setTTL("key1", 5000);
      expect(result).toBe(true);
    });
  });

  describe("键前缀", () => {
    it("应该使用自定义键前缀", async () => {
      const managerWithPrefix = new CacheManager<string>({
        backend: "memory",
        keyPrefix: "custom:",
      });
      
      await managerWithPrefix.set("key1", "value1");
      
      const keys = await managerWithPrefix.keys();
      expect(keys).toContain("custom:key1");
    });
  });

  describe.skip("统计信息", () => {
    it("应该获取统计信息", async () => {
      await manager.set("key1", "value1");
      await manager.get("key1");
      await manager.get("key1");
      await manager.get("non-existent");
      
      const stats = await manager.stats();
      
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.4, 1);
      expect(stats.totalRequests).toBe(3);
    });

    it("应该重置统计", async () => {
      await manager.get("key1");
      await manager.get("key2");
      
      manager.resetStats();
      
      const stats = await manager.stats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe.skip("事件", () => {
    it("应该发射 set 事件", async () => {
      const listener = vi.fn();
      manager.on("event", listener);
      
      await manager.set("key1", "value1");
      
      expect(listener).toHaveBeenCalled();
    });

    it("应该发射 get 事件", async () => {
      const listener = vi.fn();
      manager.on("event", listener);
      
      await manager.get("key1");
      
      expect(listener).toHaveBeenCalled();
    });

    it("应该发射 delete 事件", async () => {
      const listener = vi.fn();
      manager.on("event", listener);
      
      await manager.set("key1", "value1");
      await manager.delete("key1");
      
      expect(listener).toHaveBeenCalled();
    });

    it("应该发射 clear 事件", async () => {
      const listener = vi.fn();
      manager.on("event", listener);
      
      await manager.clear();
      
      expect(listener).toHaveBeenCalled();
    });

    it("应该发射 error 事件", async () => {
      const listener = vi.fn();
      manager.on("event", listener);
      
      // 模拟错误情况
      const backend = (manager as any).backend;
      if (backend && typeof backend.get === 'function') {
        const originalGet = backend.get.bind(backend);
        backend.get = vi.fn().mockRejectedValue(new Error("Test error"));
        
        try {
          await manager.get("key1");
        } catch {
          // 忽略错误
        }
        
        expect(listener).toHaveBeenCalled();
      }
    });
  });
});

describe.skip("createCacheManager", () => {
  it("应该创建 CacheManager 实例", () => {
    const manager = createCacheManager<string>({
      backend: "memory",
    });
    
    expect(manager).toBeDefined();
    expect(manager).toBeInstanceOf(CacheManager);
  });

  it("应该使用默认配置", () => {
    const manager = createCacheManager();
    
    expect(manager).toBeDefined();
  });
});

describe("CacheManager Redis 后端", () => {
  it("应该创建 Redis 后端的 CacheManager", () => {
    const manager = new CacheManager<string>({
      backend: "redis",
      redis: {
        url: "redis://localhost:6379",
      },
    });
    
    expect(manager).toBeDefined();
  });
});
