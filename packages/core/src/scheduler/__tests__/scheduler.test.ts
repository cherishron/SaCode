import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TaskScheduler,
  createTaskScheduler,
  calculateNextRunTime,
  type CronTask,
  type TaskExecutor,
  type TaskExecutionResult,
} from "../index.js";

// Mock 适配器
const mockAdapter = {
  platform: "telegram" as const,
  isConnected: vi.fn(() => true),
  send: vi.fn(async () => {}),
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  onMessage: vi.fn(),
  getChannels: vi.fn(async () => []),
};

const mockAdapterManager = {
  get: vi.fn((platform: string) => {
    if (platform === "telegram") return mockAdapter;
    return undefined;
  }),
};

// 测试执行器
class TestExecutor implements TaskExecutor {
  async execute(task: CronTask): Promise<TaskExecutionResult> {
    return {
      taskId: task.id,
      success: true,
      executedAt: new Date(),
      response: `Executed: ${task.message}`,
    };
  }
}

describe("TaskScheduler", () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new TaskScheduler(
      { autoStart: false, persistTasks: false, checkInterval: 1000 },
      {
        executor: new TestExecutor(),
        adapterManager: mockAdapterManager,
      }
    );
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  describe("addTask", () => {
    it("应该添加间隔任务", async () => {
      const task = await scheduler.addTask({
        name: "测试间隔任务",
        type: "interval",
        config: { interval: 60 },
        message: "测试消息",
        channel: "telegram",
        chatId: "test_chat",
      });

      expect(task.id).toBeDefined();
      expect(task.type).toBe("interval");
      expect(task.config.interval).toBe(60);
      expect(task.enabled).toBe(true);
      expect(task.nextRunAt).toBeInstanceOf(Date);
    });

    it("应该添加一次性任务", async () => {
      const executeAt = new Date(Date.now() + 3600000); // 1小时后
      const task = await scheduler.addTask({
        name: "测试一次性任务",
        type: "once",
        config: { executeAt },
        message: "一次性消息",
        channel: "telegram",
        chatId: "test_chat",
      });

      expect(task.type).toBe("once");
      expect(task.config.executeAt).toEqual(executeAt);
    });

    it("应该添加 Cron 任务", async () => {
      const task = await scheduler.addTask({
        name: "测试 Cron 任务",
        type: "cron",
        config: { cronExpression: "0 9 * * *" },
        message: "每日摘要",
        channel: "telegram",
        chatId: "test_chat",
      });

      expect(task.type).toBe("cron");
      expect(task.config.cronExpression).toBe("0 9 * * *");
      expect(task.nextRunAt).toBeInstanceOf(Date);
    });

    it("应该拒绝无效的 Cron 表达式", async () => {
      await expect(
        scheduler.addTask({
          name: "无效任务",
          type: "cron",
          config: { cronExpression: "invalid" },
          message: "测试",
          channel: "telegram",
          chatId: "test_chat",
        })
      ).rejects.toThrow();
    });
  });

  describe("removeTask", () => {
    it("应该移除任务", async () => {
      const task = await scheduler.addTask({
        name: "待移除任务",
        type: "interval",
        config: { interval: 60 },
        message: "测试",
        channel: "telegram",
        chatId: "test_chat",
      });

      const result = await scheduler.removeTask(task.id);
      expect(result).toBe(true);
      expect(scheduler.getTask(task.id)).toBeUndefined();
    });

    it("应该返回 false 如果任务不存在", async () => {
      const result = await scheduler.removeTask("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("enableTask / disableTask", () => {
    it("应该禁用任务", async () => {
      const task = await scheduler.addTask({
        name: "测试任务",
        type: "interval",
        config: { interval: 60 },
        message: "测试",
        channel: "telegram",
        chatId: "test_chat",
      });

      const updated = await scheduler.disableTask(task.id);
      expect(updated?.enabled).toBe(false);
    });

    it("应该启用任务", async () => {
      const task = await scheduler.addTask({
        name: "测试任务",
        type: "interval",
        config: { interval: 60 },
        message: "测试",
        channel: "telegram",
        chatId: "test_chat",
        enabled: false,
      });

      const updated = await scheduler.enableTask(task.id);
      expect(updated?.enabled).toBe(true);
      expect(updated?.nextRunAt).toBeInstanceOf(Date);
    });
  });

  describe("runTask", () => {
    it("应该手动执行任务", async () => {
      const task = await scheduler.addTask({
        name: "测试任务",
        type: "interval",
        config: { interval: 60 },
        message: "测试消息",
        channel: "telegram",
        chatId: "test_chat",
      });

      const result = await scheduler.runTask(task.id);
      expect(result.success).toBe(true);
      expect(result.response).toContain("Executed");
    });

    it("应该返回错误如果任务不存在", async () => {
      const result = await scheduler.runTask("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Task not found");
    });
  });

  describe("updateTask", () => {
    it("应该更新任务", async () => {
      const task = await scheduler.addTask({
        name: "原名称",
        type: "interval",
        config: { interval: 60 },
        message: "原消息",
        channel: "telegram",
        chatId: "test_chat",
      });

      const updated = await scheduler.updateTask(task.id, {
        name: "新名称",
        message: "新消息",
      });

      expect(updated?.name).toBe("新名称");
      expect(updated?.message).toBe("新消息");
    });
  });

  describe("getStats", () => {
    it("应该返回正确的统计信息", async () => {
      await scheduler.addTask({
        name: "间隔任务",
        type: "interval",
        config: { interval: 60 },
        message: "测试",
        channel: "telegram",
        chatId: "test_chat",
      });

      await scheduler.addTask({
        name: "Cron 任务",
        type: "cron",
        config: { cronExpression: "0 9 * * *" },
        message: "测试",
        channel: "telegram",
        chatId: "test_chat",
        enabled: false,
      });

      const stats = scheduler.getStats();
      expect(stats.total).toBe(2);
      expect(stats.enabled).toBe(1);
      expect(stats.disabled).toBe(1);
      expect(stats.byType.interval).toBe(1);
      expect(stats.byType.cron).toBe(1);
    });
  });

  describe("getTasksByType", () => {
    it("应该按类型筛选任务", async () => {
      await scheduler.addTask({
        name: "间隔任务 1",
        type: "interval",
        config: { interval: 60 },
        message: "测试",
        channel: "telegram",
        chatId: "test_chat",
      });

      await scheduler.addTask({
        name: "Cron 任务",
        type: "cron",
        config: { cronExpression: "0 9 * * *" },
        message: "测试",
        channel: "telegram",
        chatId: "test_chat",
      });

      const intervalTasks = scheduler.getTasksByType("interval");
      expect(intervalTasks).toHaveLength(1);
      expect(intervalTasks[0]?.type).toBe("interval");

      const cronTasks = scheduler.getTasksByType("cron");
      expect(cronTasks).toHaveLength(1);
    });
  });

  describe("事件", () => {
    it("应该触发 scheduled 事件", async () => {
      const handler = vi.fn();
      scheduler.on("scheduled", handler);

      await scheduler.addTask({
        name: "测试任务",
        type: "interval",
        config: { interval: 60 },
        message: "测试",
        channel: "telegram",
        chatId: "test_chat",
      });

      expect(handler).toHaveBeenCalled();
    });

    it("应该触发 completed 事件", async () => {
      const handler = vi.fn();
      scheduler.on("completed", handler);

      const task = await scheduler.addTask({
        name: "测试任务",
        type: "interval",
        config: { interval: 60 },
        message: "测试",
        channel: "telegram",
        chatId: "test_chat",
      });

      await scheduler.runTask(task.id);

      expect(handler).toHaveBeenCalled();
    });
  });
});

describe("calculateNextRunTime", () => {
  it("应该计算间隔任务的下次执行时间", () => {
    const task: CronTask = {
      id: "test",
      name: "测试",
      type: "interval",
      config: { interval: 60 },
      message: "测试",
      channel: "telegram",
      chatId: "test",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      runCount: 0,
      maxRetries: 3,
      retryCount: 0,
    };

    const nextRun = calculateNextRunTime(task);
    expect(nextRun).toBeInstanceOf(Date);
    expect(nextRun!.getTime()).toBeGreaterThan(Date.now());
  });

  it("应该计算一次性任务的执行时间", () => {
    const executeAt = new Date(Date.now() + 3600000);
    const task: CronTask = {
      id: "test",
      name: "测试",
      type: "once",
      config: { executeAt },
      message: "测试",
      channel: "telegram",
      chatId: "test",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      runCount: 0,
      maxRetries: 3,
      retryCount: 0,
    };

    const nextRun = calculateNextRunTime(task);
    expect(nextRun).toEqual(executeAt);
  });

  it("应该计算 Cron 任务的下次执行时间", () => {
    const task: CronTask = {
      id: "test",
      name: "测试",
      type: "cron",
      config: { cronExpression: "0 9 * * *" },
      message: "测试",
      channel: "telegram",
      chatId: "test",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      runCount: 0,
      maxRetries: 3,
      retryCount: 0,
    };

    const nextRun = calculateNextRunTime(task);
    expect(nextRun).toBeInstanceOf(Date);
    expect(nextRun!.getHours()).toBe(9);
    expect(nextRun!.getMinutes()).toBe(0);
  });
});

describe("createTaskScheduler", () => {
  it("应该创建调度器实例", () => {
    const scheduler = createTaskScheduler({ autoStart: false });
    expect(scheduler).toBeInstanceOf(TaskScheduler);
    scheduler.stop();
  });
});
