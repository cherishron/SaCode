/**
 * Long Task Manager - 长任务管理器
 *
 * 支持后台执行长时间运行的任务，提供进度跟踪、中断和恢复功能
 */

import EventEmitter from "eventemitter3";
import { v4 as uuidv4 } from "uuid";

/**
 * 任务状态
 */
export type TaskStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * 任务优先级
 */
export type TaskPriority = "low" | "normal" | "high" | "critical";

/**
 * 任务步骤
 */
export interface TaskStep {
  id: string;
  name: string;
  description?: string;
  status: TaskStatus;
  progress: number; // 0-100
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: unknown;
}

/**
 * 长任务定义
 */
export interface LongTask {
  id: string;
  name: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number; // 0-100
  totalSteps: number;
  completedSteps: number;
  steps: TaskStep[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  updatedAt: Date;
  error?: string;
  result?: unknown;
  parentTaskId?: string;
  tags: string[];
}

/**
 * 任务执行器
 */
export type LongTaskExecutor = (
  task: LongTask,
  context: TaskContext
) => Promise<unknown>;

/**
 * 任务上下文
 */
export interface TaskContext {
  reportProgress: (progress: number, message?: string) => void;
  reportStep: (stepId: string, progress: number, result?: unknown) => void;
  isCancelled: () => boolean;
  pause: () => void;
  resume: () => void;
  log: (message: string, level?: "info" | "warn" | "error") => void;
  getMetadata: () => Record<string, unknown>;
  setMetadata: (key: string, value: unknown) => void;
}

/**
 * 任务事件
 */
export interface LongTaskEvent {
  type:
    | "created"
    | "started"
    | "progress"
    | "step_completed"
    | "paused"
    | "resumed"
    | "completed"
    | "failed"
    | "cancelled";
  task: LongTask;
  data?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * 长任务管理器选项
 */
export interface LongTaskManagerOptions {
  maxConcurrentTasks?: number;
  taskTimeout?: number; // 毫秒
  persistence?: TaskPersistence;
  onTaskEvent?: (event: LongTaskEvent) => void;
}

/**
 * 任务持久化接口
 */
export interface TaskPersistence {
  save(task: LongTask): Promise<void>;
  load(id: string): Promise<LongTask | null>;
  loadAll(): Promise<LongTask[]>;
  delete(id: string): Promise<void>;
}

/**
 * 任务注册项
 */
interface TaskRegistryEntry {
  definition: Omit<LongTask, "id" | "status" | "progress" | "steps" | "createdAt" | "updatedAt">;
  executor: LongTaskExecutor;
}

/**
 * 长任务管理器
 */
export class LongTaskManager extends EventEmitter<{ event: (e: LongTaskEvent) => void }> {
  private tasks: Map<string, LongTask> = new Map();
  private registry: Map<string, TaskRegistryEntry> = new Map();
  private runningTasks: Set<string> = new Set();
  private maxConcurrentTasks: number;
  private taskTimeout: number;
  private persistence: TaskPersistence | undefined;
  private onTaskEvent: ((event: LongTaskEvent) => void) | undefined;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(options: LongTaskManagerOptions = {}) {
    super();
    this.maxConcurrentTasks = options.maxConcurrentTasks ?? 3;
    this.taskTimeout = options.taskTimeout ?? 3600000; // 默认 1 小时
    if (options.persistence !== undefined) {
      this.persistence = options.persistence;
    } else {
      this.persistence = undefined;
    }
    if (options.onTaskEvent !== undefined) {
      this.onTaskEvent = options.onTaskEvent;
    } else {
      this.onTaskEvent = undefined;
    }
  }

  /**
   * 注册任务类型
   */
  registerTaskType(
    type: string,
    definition: Omit<LongTask, "id" | "status" | "progress" | "steps" | "createdAt" | "updatedAt">,
    executor: LongTaskExecutor
  ): void {
    this.registry.set(type, { definition, executor });
  }

  /**
   * 创建任务
   */
  async createTask(
    type: string,
    overrides?: Partial<LongTask>
  ): Promise<LongTask> {
    const entry = this.registry.get(type);
    if (!entry) {
      throw new Error(`Unknown task type: ${type}`);
    }

    // 构建基础任务对象
    const task: LongTask = {
      id: uuidv4(),
      name: overrides?.name ?? entry.definition.name,
      status: "pending",
      priority: overrides?.priority ?? entry.definition.priority,
      progress: 0,
      totalSteps: overrides?.totalSteps ?? entry.definition.totalSteps,
      completedSteps: 0,
      steps: [],
      metadata: { ...entry.definition.metadata, ...overrides?.metadata },
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [...entry.definition.tags, ...(overrides?.tags ?? [])],
    };

    // 设置可选属性（只在有值时才设置）
    if (overrides?.description !== undefined) {
      task.description = overrides.description;
    } else if (entry.definition.description !== undefined) {
      task.description = entry.definition.description;
    }

    if (overrides?.parentTaskId !== undefined) {
      task.parentTaskId = overrides.parentTaskId;
    } else if (entry.definition.parentTaskId !== undefined) {
      task.parentTaskId = entry.definition.parentTaskId;
    }

    this.tasks.set(task.id, task);
    await this.persistTask(task);

    this.emitEvent("created", task);
    return task;
  }

  /**
   * 启动任务
   */
  async startTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== "pending" && task.status !== "paused") {
      throw new Error(`Cannot start task in status: ${task.status}`);
    }

    if (this.runningTasks.size >= this.maxConcurrentTasks) {
      throw new Error("Maximum concurrent tasks reached");
    }

    const entry = this.registry.get(task.name);
    if (!entry) {
      throw new Error(`Task type not registered: ${task.name}`);
    }

    // 创建 AbortController
    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);

    // 更新任务状态
    task.status = "running";
    task.startedAt = task.startedAt ?? new Date();
    task.updatedAt = new Date();
    this.runningTasks.add(taskId);

    await this.persistTask(task);
    this.emitEvent("started", task);

    // 执行任务
    this.executeTask(task, entry.executor, abortController.signal).catch(
      async (error) => {
        const currentTask = this.tasks.get(taskId);
        if (currentTask && currentTask.status === "running") {
          currentTask.status = "failed";
          currentTask.error = error instanceof Error ? error.message : String(error);
          currentTask.updatedAt = new Date();
          await this.persistTask(currentTask);
          this.emitEvent("failed", currentTask, { error: currentTask.error });
        }
      }
    );
  }

  /**
   * 执行任务
   */
  private async executeTask(
    task: LongTask,
    executor: LongTaskExecutor,
    signal: AbortSignal
  ): Promise<void> {
    let cancelled = false;
    let paused = false;

    const context: TaskContext = {
      reportProgress: async (progress: number, message?: string) => {
        if (cancelled || paused) return;
        task.progress = Math.min(100, Math.max(0, progress));
        task.updatedAt = new Date();
        if (message) {
          task.metadata.lastMessage = message;
        }
        await this.persistTask(task);
        this.emitEvent("progress", task, { progress, message });
      },

      reportStep: async (stepId: string, progress: number, result?: unknown) => {
        if (cancelled) return;
        const step = task.steps.find((s) => s.id === stepId);
        if (step) {
          step.progress = progress;
          step.status = progress >= 100 ? "completed" : "running";
          if (result !== undefined) {
            step.result = result;
          }
          if (progress >= 100) {
            step.completedAt = new Date();
            task.completedSteps++;
          }
        }
        task.updatedAt = new Date();
        await this.persistTask(task);
        this.emitEvent("step_completed", task, { stepId, progress, result });
      },

      isCancelled: () => cancelled,

      pause: async () => {
        paused = true;
        task.status = "paused";
        task.updatedAt = new Date();
        await this.persistTask(task);
        this.emitEvent("paused", task);
      },

      resume: async () => {
        paused = false;
        task.status = "running";
        task.updatedAt = new Date();
        await this.persistTask(task);
        this.emitEvent("resumed", task);
      },

      log: (message: string, level: "info" | "warn" | "error" = "info") => {
        const logs = (task.metadata.logs as unknown[]) ?? [];
        logs.push({ timestamp: new Date(), level, message });
        task.metadata.logs = logs;
      },

      getMetadata: () => task.metadata,

      setMetadata: (key: string, value: unknown) => {
        task.metadata[key] = value;
      },
    };

    // 监听取消信号
    signal.addEventListener("abort", () => {
      cancelled = true;
    });

    try {
      // 设置超时
      const timeoutId = setTimeout(() => {
        if (task.status === "running") {
          this.cancelTask(task.id, "Timeout");
        }
      }, this.taskTimeout);

      const result = await executor(task, context);
      clearTimeout(timeoutId);

      if (!cancelled && task.status === "running") {
        task.status = "completed";
        task.progress = 100;
        task.result = result;
        task.completedAt = new Date();
        task.updatedAt = new Date();
        await this.persistTask(task);
        this.emitEvent("completed", task, { result });
      }
    } finally {
      this.runningTasks.delete(task.id);
      this.abortControllers.delete(task.id);
    }
  }

  /**
   * 暂停任务
   */
  async pauseTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== "running") {
      throw new Error(`Cannot pause task in status: ${task.status}`);
    }

    task.status = "paused";
    task.updatedAt = new Date();
    await this.persistTask(task);
    this.emitEvent("paused", task);
  }

  /**
   * 恢复任务
   */
  async resumeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== "paused") {
      throw new Error(`Cannot resume task in status: ${task.status}`);
    }

    await this.startTask(taskId);
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string, reason?: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status === "completed" || task.status === "cancelled") {
      throw new Error(`Cannot cancel task in status: ${task.status}`);
    }

    // 发送取消信号
    const abortController = this.abortControllers.get(taskId);
    if (abortController) {
      abortController.abort();
    }

    task.status = "cancelled";
    task.error = reason ?? "Cancelled by user";
    task.updatedAt = new Date();
    this.runningTasks.delete(taskId);
    await this.persistTask(task);
    this.emitEvent("cancelled", task, { reason });
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): LongTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): LongTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取运行中的任务
   */
  getRunningTasks(): LongTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === "running");
  }

  /**
   * 添加步骤到任务
   */
  async addStep(
    taskId: string,
    step: Omit<TaskStep, "id" | "status" | "progress">
  ): Promise<TaskStep> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const newStep: TaskStep = {
      id: uuidv4(),
      name: step.name,
      status: "pending",
      progress: 0,
    };

    // 设置可选属性
    if (step.description !== undefined) {
      newStep.description = step.description;
    }
    if (step.startedAt !== undefined) {
      newStep.startedAt = step.startedAt;
    }
    if (step.completedAt !== undefined) {
      newStep.completedAt = step.completedAt;
    }
    if (step.error !== undefined) {
      newStep.error = step.error;
    }
    if (step.result !== undefined) {
      newStep.result = step.result;
    }

    task.steps.push(newStep);
    task.totalSteps++;
    task.updatedAt = new Date();
    await this.persistTask(task);

    return newStep;
  }

  /**
   * 从持久化存储加载任务
   */
  async loadTasks(): Promise<void> {
    if (this.persistence) {
      const tasks = await this.persistence.loadAll();
      for (const task of tasks) {
        this.tasks.set(task.id, task);
      }
    }
  }

  /**
   * 持久化任务
   */
  private async persistTask(task: LongTask): Promise<void> {
    if (this.persistence) {
      await this.persistence.save(task);
    }
  }

  /**
   * 发送事件
   */
  private emitEvent(
    type: LongTaskEvent["type"],
    task: LongTask,
    data?: Record<string, unknown>
  ): void {
    const event: LongTaskEvent = {
      type,
      task,
      timestamp: new Date(),
    };

    // 只有在 data 有值时才设置
    if (data !== undefined) {
      event.data = data;
    }

    this.emit("event", event);
    this.onTaskEvent?.(event);
  }
}

/**
 * 创建长任务管理器
 */
export function createLongTaskManager(
  options?: LongTaskManagerOptions
): LongTaskManager {
  return new LongTaskManager(options);
}

/**
 * 预定义任务类型
 */
export const TaskTypes = {
  /**
   * 文件处理任务
   */
  FILE_PROCESSING: "file-processing",

  /**
   * 数据分析任务
   */
  DATA_ANALYSIS: "data-analysis",

  /**
   * 批量操作任务
   */
  BATCH_OPERATION: "batch-operation",

  /**
   * 代码生成任务
   */
  CODE_GENERATION: "code-generation",

  /**
   * 报告生成任务
   */
  REPORT_GENERATION: "report-generation",
};
