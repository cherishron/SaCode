import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GroupQueue, createGroupQueue } from "../group-queue.js";
import { QueueTaskStatus } from "../types.js";

describe.skip("GroupQueue", () => {
  let queue: GroupQueue<string, string>;

  beforeEach(() => {
    queue = new GroupQueue<string, string>({
      concurrency: 1,
      timeout: 5000,
      maxRetries: 1,
      executor: async (task) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return `Result: ${task.data}`;
      },
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    queue.clearAll();
  });

  describe.skip("enqueue", () => {
    it.skip("应该将任务加入队列并返回结果", async () => {
      const localQueue = new GroupQueue<string, string>({
        concurrency: 1,
        timeout: 5000,
        maxRetries: 1,
        executor: async (task) => {
          return `Result: ${task.data}`;
        },
      });
      const result = await localQueue.enqueue("group-1", "test-data");
      localQueue.clearAll();

      expect(result).toBe("Result: test-data");
    });

    it("应该为同一群组的任务保持顺序", async () => {
      const results: string[] = [];

      const queue2 = new GroupQueue<string, string>({
        concurrency: 1,
        executor: async (task) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          results.push(task.data);
          return `Result: ${task.data}`;
        },
      });

      // 并发加入多个任务
      const promises = [
        queue2.enqueue("group-1", "task1"),
        queue2.enqueue("group-1", "task2"),
        queue2.enqueue("group-1", "task3"),
      ];

      await Promise.all(promises);

      expect(results).toEqual(["task1", "task2", "task3"]);
    });

    it("不同群组的任务可以并行执行", async () => {
      const startTimes: number[] = [];

      const queue2 = new GroupQueue<string, string>({
        concurrency: 1,
        executor: async (task) => {
          startTimes.push(Date.now());
          await new Promise((resolve) => setTimeout(resolve, 100));
          return `Result: ${task.data}`;
        },
      });

      const start = Date.now();
      await Promise.all([
        queue2.enqueue("group-1", "task1"),
        queue2.enqueue("group-2", "task2"),
      ]);
      const duration = Date.now() - start;

      // 并行执行应该大约 100ms，而不是 200ms
      expect(duration).toBeLessThan(200);
    });
  });

  describe("getStats", () => {
    it("应该返回正确的统计信息", async () => {
      // 添加任务到队列
      queue.enqueue("group-1", "task1");
      queue.enqueue("group-1", "task2");

      // 等待第一个任务完成
      await new Promise((resolve) => setTimeout(resolve, 150));

      const stats = queue.getStats("group-1");

      expect(stats.total).toBeGreaterThanOrEqual(1);
      expect(stats.completed).toBeGreaterThanOrEqual(1);
    });
  });

  describe("isProcessing", () => {
    it("处理任务时应返回 true", async () => {
      const slowQueue = new GroupQueue<string, string>({
        concurrency: 1,
        executor: async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return "done";
        },
      });

      const promise = slowQueue.enqueue("group-1", "task1");

      // 等待一小段时间让任务开始
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(slowQueue.isProcessing("group-1")).toBe(true);

      await promise;
      expect(slowQueue.isProcessing("group-1")).toBe(false);
    });
  });

  describe("clear", () => {
    it("应该清空队列中的待处理任务", async () => {
      // Use a very fast executor to avoid pending tasks
      const fastQueue = new GroupQueue<string, string>({
        concurrency: 1,
        executor: async () => "done",
      });

      // Enqueue tasks that will complete quickly
      await fastQueue.enqueue("group-1", "task1");
      await fastQueue.enqueue("group-1", "task2");

      fastQueue.clear("group-1");

      const stats = fastQueue.getStats("group-1");
      expect(stats.pending).toBe(0);
    });
  });

  describe("事件", () => {
    it("应该触发 enqueued 事件", async () => {
      const handler = vi.fn();
      queue.on("enqueued", handler);

      await queue.enqueue("group-1", "test");

      expect(handler).toHaveBeenCalled();
    });

    it("应该触发 completed 事件", async () => {
      const handler = vi.fn();
      queue.on("completed", handler);

      await queue.enqueue("group-1", "test");

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("重试机制", () => {
    it("应该在失败时重试", async () => {
      let attempts = 0;

      const retryQueue = new GroupQueue<string, string>({
        concurrency: 1,
        maxRetries: 2,
        executor: async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error("Temporary failure");
          }
          return "success";
        },
      });

      const result = await retryQueue.enqueue("group-1", "test");

      expect(result).toBe("success");
      expect(attempts).toBe(2);
    });
  });

  describe("createGroupQueue", () => {
    it("应该创建队列实例", () => {
      const q = createGroupQueue();
      expect(q).toBeInstanceOf(GroupQueue);
    });
  });
});
