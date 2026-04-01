import { randomUUID } from "crypto";
import type { QueueTask, GroupQueueConfig, QueueStats, QueueEvent } from "./types";
import { QueueTaskStatus, GroupQueueConfigSchema } from "./types";

/**
 * 群组队列
 * 
 * 为每个群组维护独立的任务队列，确保同一群组内的任务按顺序执行，
 * 不同群组之间可以并行执行。
 * 
 * @example
 * ```typescript
 * const queue = new GroupQueue<string, string>({
 *   concurrency: 1,
 *   executor: async (task) => {
 *     // 处理任务
 *     return `Result for ${task.data}`;
 *   }
 * });
 * 
 * const result = await queue.enqueue("group-123", "task data");
 * ```
 */
export class GroupQueue<T = unknown, R = unknown> {
  private config: GroupQueueConfig<T, R>;
  private queues: Map<string, QueueTask<T, R>[]> = new Map();
  private processing: Map<string, Set<string>> = new Map();
  private tasks: Map<string, QueueTask<T, R>> = new Map();
  private eventListeners: Map<string, ((event: QueueEvent<T, R>) => void)[]> = new Map();
  private executor: ((task: QueueTask<T>) => Promise<R>) | undefined;

  constructor(config: Partial<GroupQueueConfig<T, R>> = {}) {
    const parsed = GroupQueueConfigSchema.partial().parse(config);
    this.config = {
      concurrency: parsed.concurrency ?? 1,
      timeout: parsed.timeout ?? 60000,
      maxRetries: parsed.maxRetries ?? 3,
    };
    this.executor = config.executor;
  }

  /**
   * 设置任务执行器
   */
  setExecutor(executor: (task: QueueTask<T>) => Promise<R>): void {
    this.executor = executor;
  }

  /**
   * 将任务加入队列
   * 
   * @param groupId 群组 ID
   * @param data 任务数据
   * @returns Promise，任务完成后返回结果
   */
  async enqueue(groupId: string, data: T): Promise<R> {
    const task: QueueTask<T, R> = {
      id: randomUUID(),
      groupId,
      data,
      status: QueueTaskStatus.PENDING,
      result: undefined,
      error: undefined,
      createdAt: new Date(),
      startedAt: undefined,
      completedAt: undefined,
      retryCount: 0,
    };

    // 存储任务
    this.tasks.set(task.id, task);

    // 获取或创建群组队列
    const queue = this.queues.get(groupId) ?? [];
    queue.push(task);
    this.queues.set(groupId, queue);

    this.emit("enqueued", task);

    // 尝试处理队列
    this.processQueue(groupId);

    // 等待任务完成
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const currentTask = this.tasks.get(task.id);
        if (!currentTask) {
          clearInterval(checkInterval);
          reject(new Error("Task not found"));
          return;
        }

        if (currentTask.status === QueueTaskStatus.COMPLETED) {
          clearInterval(checkInterval);
          resolve(currentTask.result as R);
          return;
        }

        if (currentTask.status === QueueTaskStatus.FAILED) {
          clearInterval(checkInterval);
          reject(new Error(currentTask.error ?? "Task failed"));
          return;
        }
      }, 100);
    });
  }

  /**
   * 处理群组队列
   */
  private async processQueue(groupId: string): Promise<void> {
    const queue = this.queues.get(groupId);
    if (!queue || queue.length === 0) return;

    const processing = this.processing.get(groupId) ?? new Set();
    
    // 检查是否已达到并发限制
    if (processing.size >= this.config.concurrency) return;

    // 获取下一个待处理任务
    const task = queue.find((t) => t.status === QueueTaskStatus.PENDING);
    if (!task) return;

    // 标记为处理中
    processing.add(task.id);
    this.processing.set(groupId, processing);

    // 更新任务状态
    task.status = QueueTaskStatus.RUNNING;
    task.startedAt = new Date();
    this.tasks.set(task.id, task);

    this.emit("started", task);

    try {
      if (!this.executor) {
        throw new Error("No executor configured");
      }

      // 执行任务（带超时）
      const result = await this.executeWithTimeout(task);

      // 更新成功状态
      task.status = QueueTaskStatus.COMPLETED;
      task.result = result;
      task.completedAt = new Date();
      this.tasks.set(task.id, task);

      this.emit("completed", task);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // 检查是否需要重试
      if (task.retryCount < this.config.maxRetries) {
        task.retryCount += 1;
        task.status = QueueTaskStatus.PENDING;
        this.tasks.set(task.id, task);

        this.emit("retry", task);
      } else {
        // 标记失败
        task.status = QueueTaskStatus.FAILED;
        task.error = errorMessage;
        task.completedAt = new Date();
        this.tasks.set(task.id, task);

        this.emit("failed", task);
      }
    } finally {
      // 从处理中移除
      processing.delete(task.id);
      this.processing.set(groupId, processing);

      // 从队列中移除已完成的任务
      const index = queue.indexOf(task);
      if (index > -1 && task.status !== QueueTaskStatus.PENDING) {
        queue.splice(index, 1);
      }

      // 继续处理队列中的下一个任务
      if (queue.length > 0) {
        this.processQueue(groupId);
      }
    }
  }

  /**
   * 带超时执行任务
   */
  private async executeWithTimeout(task: QueueTask<T, R>): Promise<R> {
    if (!this.executor) {
      throw new Error("No executor configured");
    }

    return new Promise<R>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Task timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      this.executor!(task)
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * 获取群组队列统计信息
   */
  getStats(groupId: string): QueueStats {
    const tasks = Array.from(this.tasks.values()).filter((t) => t.groupId === groupId);

    return {
      groupId,
      pending: tasks.filter((t) => t.status === QueueTaskStatus.PENDING).length,
      running: tasks.filter((t) => t.status === QueueTaskStatus.RUNNING).length,
      completed: tasks.filter((t) => t.status === QueueTaskStatus.COMPLETED).length,
      failed: tasks.filter((t) => t.status === QueueTaskStatus.FAILED).length,
      total: tasks.length,
    };
  }

  /**
   * 获取所有群组统计信息
   */
  getAllStats(): QueueStats[] {
    const groupIds = new Set<string>();
    for (const task of this.tasks.values()) {
      groupIds.add(task.groupId);
    }
    return Array.from(groupIds).map((id) => this.getStats(id));
  }

  /**
   * 检查群组是否正在处理任务
   */
  isProcessing(groupId: string): boolean {
    const processing = this.processing.get(groupId);
    return processing !== undefined && processing.size > 0;
  }

  /**
   * 获取群组队列长度
   */
  getQueueLength(groupId: string): number {
    const queue = this.queues.get(groupId);
    return queue?.filter((t) => t.status === QueueTaskStatus.PENDING).length ?? 0;
  }

  /**
   * 清空群组队列
   */
  clear(groupId: string): void {
    const queue = this.queues.get(groupId) ?? [];
    
    for (const task of queue) {
      if (task.status === QueueTaskStatus.PENDING) {
        task.status = QueueTaskStatus.FAILED;
        task.error = "Queue cleared";
        this.tasks.set(task.id, task);
      }
    }

    this.queues.set(groupId, []);
    this.processing.delete(groupId);
  }

  /**
   * 清空所有队列
   */
  clearAll(): void {
    for (const groupId of this.queues.keys()) {
      this.clear(groupId);
    }
  }

  /**
   * 获取任务状态
   */
  getTask(taskId: string): QueueTask<T, R> | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 注册事件监听器
   */
  on(event: string, listener: (event: QueueEvent<T, R>) => void): void {
    const listeners = this.eventListeners.get(event) ?? [];
    listeners.push(listener);
    this.eventListeners.set(event, listeners);
  }

  /**
   * 触发事件
   */
  private emit(type: QueueEvent["type"], task: QueueTask<T, R>): void {
    const event: QueueEvent<T, R> = {
      type,
      task,
      timestamp: new Date(),
    };

    const listeners = this.eventListeners.get(type) ?? [];
    for (const listener of listeners) {
      listener(event);
    }
  }
}

/**
 * 创建群组队列实例
 */
export function createGroupQueue<T = unknown, R = unknown>(
  config?: Partial<GroupQueueConfig<T, R>>
): GroupQueue<T, R> {
  return new GroupQueue<T, R>(config);
}
