import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type {
  CronTask,
  CreateTaskInput,
  TaskSchedulerConfig,
  TaskExecutionResult,
  TaskEvent,
  TaskEventCallback,
  TaskExecutor,
  TaskExecutionLog,
  TaskStats,
  TaskType,
  Platform,
  IMAdapter,
  IMMessage,
} from "./types";
import {
  CronTaskSchema,
  DEFAULT_SCHEDULER_CONFIG,
} from "./types";

// Re-export types
export * from "./types";

/**
 * 解析 Cron 表达式
 * 支持: minute hour day month weekday
 */
function parseCron(expression: string): { next: (from: Date) => Date } {
  const parts = expression.split(" ");
  const [minute = "*", hour = "*", day = "*", month = "*", weekday = "*"] = parts;

  return {
    next: (from: Date): Date => {
      const next = new Date(from);

      // 按分钟递增检查
      for (let i = 0; i < 525600; i++) {
        // 最多检查一年内的分钟数
        next.setMinutes(next.getMinutes() + 1);
        next.setSeconds(0);
        next.setMilliseconds(0);

        const nextMinute = next.getMinutes();
        const nextHour = next.getHours();
        const nextDay = next.getDate();
        const nextMonth = next.getMonth() + 1;
        const nextWeekday = next.getDay();

        if (
          matchCronPart(minute, nextMinute, 0, 59) &&
          matchCronPart(hour, nextHour, 0, 23) &&
          matchCronPart(day, nextDay, 1, 31) &&
          matchCronPart(month, nextMonth, 1, 12) &&
          matchCronPart(weekday, nextWeekday, 0, 6)
        ) {
          return next;
        }
      }

      // 如果没找到，返回一天后
      return new Date(from.getTime() + 24 * 60 * 60 * 1000);
    },
  };
}

/**
 * 匹配 Cron 部分
 */
function matchCronPart(pattern: string, value: number, min: number, _max: number): boolean {
  if (pattern === "*") return true;

  if (pattern.includes(",")) {
    return pattern.split(",").some((p) => matchCronPart(p.trim(), value, min, _max));
  }

  if (pattern.includes("/")) {
    const parts = pattern.split("/");
    const stepStr = parts[1] ?? "1";
    const step = parseInt(stepStr, 10);
    return (value - min) % step === 0;
  }

  if (pattern.includes("-")) {
    const parts = pattern.split("-");
    const startStr = parts[0] ?? "0";
    const endStr = parts[1] ?? "0";
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    return value >= start && value <= end;
  }

  return parseInt(pattern, 10) === value;
}

/**
 * 计算下次执行时间
 */
function calculateNextRunTime(task: CronTask): Date | null {
  switch (task.type) {
    case "interval":
      if (!task.config.interval) return null;
      return new Date(Date.now() + task.config.interval * 1000);

    case "once":
      if (!task.config.executeAt) return null;
      return new Date(task.config.executeAt);

    case "cron":
      if (!task.config.cronExpression) return null;
      return parseCron(task.config.cronExpression).next(new Date());

    default:
      return null;
  }
}

/**
 * IM 适配器管理器接口
 */
interface IAdapterManager {
  get(platform: Platform): IMAdapter | undefined;
}

/**
 * 默认任务执行器
 */
class DefaultTaskExecutor implements TaskExecutor {
  private adapterManager: IAdapterManager | null = null;

  setAdapterManager(manager: IAdapterManager): void {
    this.adapterManager = manager;
  }

  async execute(task: CronTask): Promise<TaskExecutionResult> {
    try {
      // 获取适配器
      const adapter = this.adapterManager?.get(task.channel as Platform);

      if (!adapter) {
        return {
          taskId: task.id,
          success: false,
          executedAt: new Date(),
          error: `No adapter found for platform: ${task.channel}`,
          retryNeeded: false,
        };
      }

      if (!adapter.isConnected()) {
        return {
          taskId: task.id,
          success: false,
          executedAt: new Date(),
          error: `Adapter for ${task.channel} is not connected`,
          retryNeeded: true,
        };
      }

      // 构建消息
      const message: IMMessage = {
        id: randomUUID(),
        platform: task.channel as Platform,
        channelId: task.chatId,
        userId: "system",
        content: task.message,
        timestamp: Date.now(),
        metadata: task.metadata,
      };

      // 发送消息
      await adapter.send(message);

      return {
        taskId: task.id,
        success: true,
        executedAt: new Date(),
        response: `Message sent to ${task.channel}:${task.chatId}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        taskId: task.id,
        success: false,
        executedAt: new Date(),
        error: errorMessage,
        retryNeeded: true,
      };
    }
  }
}

/**
 * 任务调度器
 *
 * 支持三种任务类型：
 * - interval: 间隔任务 (每 N 秒执行)
 * - once: 一次性任务 (指定时间执行)
 * - cron: Cron 表达式任务
 *
 * @example
 * ```typescript
 * const scheduler = new TaskScheduler({
 *   adapterManager: imAdapterManager,
 * });
 *
 * // 添加间隔任务
 * await scheduler.addTask({
 *   name: "每小时提醒",
 *   type: "interval",
 *   config: { interval: 3600 },
 *   message: "该休息一下了！",
 *   channel: "telegram",
 *   chatId: "123456",
 * });
 *
 * // 添加 Cron 任务
 * await scheduler.addTask({
 *   name: "每日摘要",
 *   type: "cron",
 *   config: { cronExpression: "0 9 * * *" },
 *   message: "生成今日摘要",
 *   channel: "wechat",
 *   chatId: "room_001",
 * });
 * ```
 */
export class TaskScheduler {
  private config: TaskSchedulerConfig;
  private tasks: Map<string, CronTask> = new Map();
  private runningTasks: Set<string> = new Set();
  private checkTimer: ReturnType<typeof setInterval> | undefined;
  private eventListeners: Map<string, TaskEventCallback[]> = new Map();
  private executor: TaskExecutor;
  private adapterManager: IAdapterManager | null = null;
  private executionLogs: TaskExecutionLog[] = [];
  private maxLogSize = 1000;

  constructor(
    config: Partial<TaskSchedulerConfig> = {},
    options?: {
      executor?: TaskExecutor;
      adapterManager?: IAdapterManager;
    }
  ) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.executor = options?.executor ?? new DefaultTaskExecutor();
    this.adapterManager = options?.adapterManager ?? null;

    // 设置适配器管理器到默认执行器
    if (this.executor instanceof DefaultTaskExecutor && this.adapterManager) {
      this.executor.setAdapterManager(this.adapterManager);
    }

    if (this.config.autoStart) {
      this.start();
    }
  }

  /**
   * 设置适配器管理器
   */
  setAdapterManager(manager: IAdapterManager): void {
    this.adapterManager = manager;
    if (this.executor instanceof DefaultTaskExecutor) {
      this.executor.setAdapterManager(manager);
    }
  }

  /**
   * 启动调度器
   */
  async start(): Promise<void> {
    // 加载已存储的任务
    if (this.config.persistTasks) {
      await this.loadTasks();
    }

    // 启动检查循环
    this.checkTimer = setInterval(() => {
      this.checkTasks();
    }, this.config.checkInterval);

    // 立即检查一次
    this.checkTasks();
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
  }

  /**
   * 添加任务
   */
  async addTask(input: CreateTaskInput): Promise<CronTask> {
    const now = new Date();
    const id = randomUUID();

    const task = CronTaskSchema.parse({
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      nextRunAt: null,
      runCount: 0,
      retryCount: 0,
    });

    // 计算下次执行时间
    task.nextRunAt = calculateNextRunTime(task);

    this.tasks.set(id, task);

    if (this.config.persistTasks) {
      await this.saveTasks();
    }

    this.emit("scheduled", task);

    return task;
  }

  /**
   * 移除任务
   */
  async removeTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;

    this.tasks.delete(id);

    if (this.config.persistTasks) {
      await this.saveTasks();
    }

    this.emit("cancelled", task);

    return true;
  }

  /**
   * 启用任务
   */
  async enableTask(id: string): Promise<CronTask | null> {
    const task = this.tasks.get(id);
    if (!task) return null;

    task.enabled = true;
    task.updatedAt = new Date();
    task.nextRunAt = calculateNextRunTime(task);
    task.retryCount = 0;

    this.tasks.set(id, task);

    if (this.config.persistTasks) {
      await this.saveTasks();
    }

    this.emit("updated", task);

    return task;
  }

  /**
   * 禁用任务
   */
  async disableTask(id: string): Promise<CronTask | null> {
    const task = this.tasks.get(id);
    if (!task) return null;

    task.enabled = false;
    task.updatedAt = new Date();

    this.tasks.set(id, task);

    if (this.config.persistTasks) {
      await this.saveTasks();
    }

    this.emit("updated", task);

    return task;
  }

  /**
   * 更新任务
   */
  async updateTask(
    id: string,
    updates: Partial<Omit<CreateTaskInput, "type">>
  ): Promise<CronTask | null> {
    const task = this.tasks.get(id);
    if (!task) return null;

    const updated = CronTaskSchema.parse({
      ...task,
      ...updates,
      id,
      type: task.type, // 不允许修改类型
      createdAt: task.createdAt,
      updatedAt: new Date(),
    });

    // 重新计算下次执行时间
    updated.nextRunAt = calculateNextRunTime(updated);

    this.tasks.set(id, updated);

    if (this.config.persistTasks) {
      await this.saveTasks();
    }

    this.emit("updated", updated);

    return updated;
  }

  /**
   * 手动执行任务
   */
  async runTask(id: string): Promise<TaskExecutionResult> {
    const task = this.tasks.get(id);
    if (!task) {
      return {
        taskId: id,
        success: false,
        executedAt: new Date(),
        error: "Task not found",
      };
    }

    return this.executeTask(task);
  }

  /**
   * 获取任务
   */
  getTask(id: string): CronTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * 获取所有任务
   */
  listTasks(): CronTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 按类型获取任务
   */
  getTasksByType(type: TaskType): CronTask[] {
    return this.listTasks().filter((task) => task.type === type);
  }

  /**
   * 按渠道获取任务
   */
  getTasksByChannel(channel: Platform): CronTask[] {
    return this.listTasks().filter((task) => task.channel === channel);
  }

  /**
   * 获取下次执行时间
   */
  getNextRunTime(task: CronTask): Date | null {
    return calculateNextRunTime(task);
  }

  /**
   * 获取任务统计
   */
  getStats(): TaskStats {
    const tasks = this.listTasks();
    const byType = { interval: 0, once: 0, cron: 0 };

    for (const task of tasks) {
      byType[task.type]++;
    }

    const totalRuns = tasks.reduce((sum, task) => sum + task.runCount, 0);
    const successRuns = this.executionLogs.filter((log) => log.success).length;
    const successRate = this.executionLogs.length > 0
      ? successRuns / this.executionLogs.length
      : 0;

    return {
      total: tasks.length,
      enabled: tasks.filter((t) => t.enabled).length,
      disabled: tasks.filter((t) => !t.enabled).length,
      byType,
      totalRuns,
      successRate,
    };
  }

  /**
   * 获取执行日志
   */
  getExecutionLogs(limit = 100): TaskExecutionLog[] {
    return this.executionLogs.slice(-limit);
  }

  /**
   * 清理已完成的一次性任务
   */
  async cleanCompletedOnceTasks(): Promise<number> {
    const toRemove: string[] = [];

    for (const task of this.tasks.values()) {
      if (task.type === "once" && task.runCount > 0) {
        toRemove.push(task.id);
      }
    }

    for (const id of toRemove) {
      await this.removeTask(id);
    }

    return toRemove.length;
  }

  /**
   * 检查并执行到期任务
   */
  private checkTasks(): void {
    const now = new Date();
    const runningCount = this.runningTasks.size;

    for (const task of this.tasks.values()) {
      // 跳过禁用的任务
      if (!task.enabled) continue;

      // 跳过正在执行的任务
      if (this.runningTasks.has(task.id)) continue;

      // 检查并发限制
      if (runningCount >= this.config.maxConcurrency) break;

      // 检查是否到期
      if (task.nextRunAt && task.nextRunAt <= now) {
        // 异步执行任务
        this.executeTask(task).catch(console.error);
      }
    }
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: CronTask): Promise<TaskExecutionResult> {
    const startTime = Date.now();

    // 标记为运行中
    this.runningTasks.add(task.id);
    this.emit("started", task);

    try {
      const result = await this.executor.execute(task);
      const duration = Date.now() - startTime;

      // 记录执行日志
      this.addExecutionLog({
        taskId: task.id,
        executedAt: result.executedAt,
        success: result.success,
        error: result.error,
        response: result.response,
        duration,
      });

      if (result.success) {
        // 更新任务状态
        task.lastRunAt = result.executedAt;
        task.runCount += 1;
        task.retryCount = 0;

        // 计算下次执行时间
        if (task.type === "once") {
          // 一次性任务执行后禁用
          task.enabled = false;
          task.nextRunAt = null;
        } else {
          task.nextRunAt = calculateNextRunTime(task);
        }

        this.tasks.set(task.id, task);
        this.emit("completed", task, result);
      } else {
        // 处理失败
        if (result.retryNeeded && task.retryCount < task.maxRetries) {
          task.retryCount += 1;
          task.nextRunAt = new Date(Date.now() + this.config.retryDelay);
          this.emit("retrying", task, result);
        } else {
          task.retryCount = 0;
          task.nextRunAt = calculateNextRunTime(task);
        }

        this.tasks.set(task.id, task);
        this.emit("failed", task, result);
      }

      if (this.config.persistTasks) {
        await this.saveTasks();
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - startTime;

      // 记录执行日志
      this.addExecutionLog({
        taskId: task.id,
        executedAt: new Date(),
        success: false,
        error: errorMessage,
        duration,
      });

      this.emit("failed", task, {
        taskId: task.id,
        success: false,
        executedAt: new Date(),
        error: errorMessage,
      });

      return {
        taskId: task.id,
        success: false,
        executedAt: new Date(),
        error: errorMessage,
      };
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  /**
   * 添加执行日志
   */
  private addExecutionLog(log: TaskExecutionLog): void {
    this.executionLogs.push(log);

    // 限制日志大小
    if (this.executionLogs.length > this.maxLogSize) {
      this.executionLogs = this.executionLogs.slice(-this.maxLogSize);
    }
  }

  /**
   * 从文件加载任务
   */
  private async loadTasks(): Promise<void> {
    const storagePath = this.resolveStoragePath();

    if (!fs.existsSync(storagePath)) return;

    try {
      const content = await fs.promises.readFile(storagePath, "utf-8");
      const data = JSON.parse(content);

      for (const taskData of data.tasks ?? []) {
        const task = CronTaskSchema.parse({
          ...taskData,
          createdAt: new Date(taskData.createdAt),
          updatedAt: new Date(taskData.updatedAt),
          lastRunAt: taskData.lastRunAt ? new Date(taskData.lastRunAt) : null,
          nextRunAt: taskData.nextRunAt ? new Date(taskData.nextRunAt) : null,
          config: {
            interval: taskData.config?.interval,
            executeAt: taskData.config?.executeAt ? new Date(taskData.config.executeAt) : undefined,
            cronExpression: taskData.config?.cronExpression,
          },
        });
        this.tasks.set(task.id, task);
      }

      // 加载执行日志
      if (data.logs) {
        this.executionLogs = data.logs.map((log: TaskExecutionLog) => ({
          ...log,
          executedAt: new Date(log.executedAt),
        }));
      }
    } catch (error) {
      console.error("Failed to load tasks:", error);
    }
  }

  /**
   * 保存任务到文件
   */
  private async saveTasks(): Promise<void> {
    const storagePath = this.resolveStoragePath();
    const dir = path.dirname(storagePath);

    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    const data = {
      version: 2,
      tasks: Array.from(this.tasks.values()).map((task) => ({
        ...task,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        lastRunAt: task.lastRunAt?.toISOString() ?? null,
        nextRunAt: task.nextRunAt?.toISOString() ?? null,
        config: {
          ...task.config,
          executeAt: task.config.executeAt?.toISOString(),
        },
      })),
      logs: this.executionLogs.slice(-100), // 只保存最近 100 条日志
    };

    await fs.promises.writeFile(storagePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * 解析存储路径
   */
  private resolveStoragePath(): string {
    if (path.isAbsolute(this.config.storagePath)) {
      return this.config.storagePath;
    }
    return path.resolve(process.cwd(), this.config.storagePath);
  }

  /**
   * 注册事件监听器
   */
  on(event: TaskEvent["type"], callback: TaskEventCallback): void {
    const listeners = this.eventListeners.get(event) ?? [];
    listeners.push(callback);
    this.eventListeners.set(event, listeners);
  }

  /**
   * 移除事件监听器
   */
  off(event: TaskEvent["type"], callback: TaskEventCallback): void {
    const listeners = this.eventListeners.get(event);
    if (!listeners) return;

    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * 触发事件
   */
  private emit(type: TaskEvent["type"], task: CronTask, result?: TaskExecutionResult): void {
    const event: TaskEvent = {
      type,
      task,
      timestamp: new Date(),
      error: result?.error,
      result,
    };

    const listeners = this.eventListeners.get(type) ?? [];
    for (const callback of listeners) {
      try {
        callback(event);
      } catch (error) {
        console.error("Event listener error:", error);
      }
    }
  }
}

/**
 * 创建任务调度器实例
 */
export function createTaskScheduler(
  config?: Partial<TaskSchedulerConfig>,
  options?: {
    executor?: TaskExecutor;
    adapterManager?: IAdapterManager;
  }
): TaskScheduler {
  return new TaskScheduler(config, options);
}

/**
 * 计算下次执行时间 (导出函数)
 */
export { calculateNextRunTime };