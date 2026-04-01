/**
 * Ralph Loop - 循环执行引擎
 *
 * 基于 OMO (Oh My OpenCode) 设计
 * 
 * 自动迭代执行直到任务完成：
 * - 与 TodoEnforcer 集成，按计划执行
 * - 与 IntentGate 集成，确保意图正确
 * - 支持中断和恢复
 * - 懒惰检测和强制推进
 */

import EventEmitter from "eventemitter3";
import type { TodoItem } from "./todo-enforcer";
import { TodoEnforcer } from "./todo-enforcer";
import type { ActionRecord, IntentCheckResult } from "./intent-gate";
import { IntentGate } from "./intent-gate";
import {
  createStateStore,
  generateSnapshotId,
  serializeIteration,
  deserializeIteration,
  type IStateStore,
  type RalphLoopSnapshot,
  type StateStoreConfig,
  type SerializedTodoItem,
} from "./state-store";

// ============================================
// 类型定义
// ============================================

/**
 * 循环状态
 */
export type LoopState =
  | "idle"         // 空闲
  | "running"      // 运行中
  | "paused"       // 暂停
  | "completed"    // 完成
  | "failed"       // 失败
  | "cancelled";   // 取消

/**
 * 循环步骤结果
 */
export type StepOutcome =
  | "success"      // 成功
  | "partial"      // 部分成功
  | "failed"       // 失败
  | "blocked"      // 阻塞
  | "skipped";     // 跳过

/**
 * 循环迭代记录
 */
export interface LoopIteration {
  /** 迭代序号 */
  iteration: number;
  /** 当前 Todo */
  todo?: TodoItem;
  /** 执行的行为 */
  actions: ActionRecord[];
  /** 意图检查结果 */
  intentResults: IntentCheckResult[];
  /** 步骤结果 */
  outcome: StepOutcome;
  /** 开始时间 */
  startTime: Date;
  /** 结束时间 */
  endTime?: Date;
  /** 耗时（毫秒） */
  duration?: number;
  /** 备注 */
  notes?: string;
}

/**
 * 懒惰检测结果
 */
export interface LazyDetection {
  /** 是否懒惰 */
  isLazy: boolean;
  /** 懒惰类型 */
  type: "stuck" | "repeating" | "avoiding" | "procrastinating" | "none";
  /** 证据 */
  evidence: string[];
  /** 建议的强制措施 */
  forcedActions: string[];
}

/**
 * Ralph Loop 事件
 */
export interface RalphLoopEvents {
  /** 循环开始 */
  loop_started: (task: string, totalTodos: number) => void;
  /** 迭代开始 */
  iteration_started: (iteration: LoopIteration) => void;
  /** 迭代完成 */
  iteration_completed: (iteration: LoopIteration) => void;
  /** 步骤执行 */
  step_executed: (todo: TodoItem, outcome: StepOutcome) => void;
  /** 懒惰检测 */
  lazy_detected: (detection: LazyDetection) => void;
  /** 循环暂停 */
  loop_paused: (reason: string) => void;
  /** 循环恢复 */
  loop_resumed: () => void;
  /** 循环完成 */
  loop_completed: (summary: RalphLoopSummary) => void;
  /** 错误 */
  error: (error: Error, iteration?: LoopIteration) => void;
}

/**
 * Ralph Loop 配置
 */
export interface RalphLoopConfig {
  /** 最大迭代次数 */
  maxIterations: number;
  /** 每步超时（毫秒） */
  stepTimeout: number;
  /** 总超时（毫秒） */
  totalTimeout: number;
  /** 懒惰检测间隔（迭代次数） */
  lazyCheckInterval: number;
  /** 是否启用懒惰检测 */
  enableLazyDetection: boolean;
  /** 是否启用意图门控 */
  enableIntentGate: boolean;
  /** 自动重试失败步骤 */
  autoRetryFailed: boolean;
  /** 最大重试次数 */
  maxRetries: number;
  /** 迭代间延迟（毫秒） */
  iterationDelay: number;
}

/**
 * 循环执行摘要
 */
export interface RalphLoopSummary {
  /** 任务描述 */
  task: string;
  /** 总迭代次数 */
  totalIterations: number;
  /** 成功迭代 */
  successfulIterations: number;
  /** 失败迭代 */
  failedIterations: number;
  /** 总耗时（毫秒） */
  totalTime: number;
  /** 完成率 */
  completionRate: number;
  /** 懒惰检测次数 */
  lazyDetections: number;
  /** 意图拒绝次数 */
  intentRejections: number;
  /** 最终状态 */
  finalState: LoopState;
  /** 所有迭代记录 */
  iterations: LoopIteration[];
}

// ============================================
// RalphLoop 实现
// ============================================

/**
 * Ralph 循环执行引擎
 */
export class RalphLoop extends EventEmitter<RalphLoopEvents> {
  private config: Required<RalphLoopConfig>;
  private todoEnforcer: TodoEnforcer;
  private intentGate: IntentGate;
  private stateStore: IStateStore;
  
  private state: LoopState = "idle";
  private currentTask = "";
  private currentIteration = 0;
  private iterations: LoopIteration[] = [];
  private startTime?: Date;
  private pauseReason?: string | undefined;
  private currentSnapshotId?: string;

  constructor(
    todoEnforcer?: TodoEnforcer,
    intentGate?: IntentGate,
    config?: Partial<RalphLoopConfig>,
    stateStoreConfig?: StateStoreConfig
  ) {
    super();
    
    this.todoEnforcer = todoEnforcer ?? new TodoEnforcer();
    this.intentGate = intentGate ?? new IntentGate();
    this.stateStore = createStateStore(stateStoreConfig ?? { type: "memory" });
    
    this.config = {
      maxIterations: config?.maxIterations ?? 100,
      stepTimeout: config?.stepTimeout ?? 60000,
      totalTimeout: config?.totalTimeout ?? 3600000, // 1 小时
      lazyCheckInterval: config?.lazyCheckInterval ?? 5,
      enableLazyDetection: config?.enableLazyDetection ?? true,
      enableIntentGate: config?.enableIntentGate ?? true,
      autoRetryFailed: config?.autoRetryFailed ?? true,
      maxRetries: config?.maxRetries ?? 3,
      iterationDelay: config?.iterationDelay ?? 100,
    };
  }

  // ============================================
  // 控制方法
  // ============================================

  /**
   * 启动循环
   */
  async start(task: string, todos?: TodoItem[]): Promise<RalphLoopSummary> {
    if (this.state === "running") {
      throw new Error("Loop is already running");
    }

    // 初始化
    this.currentTask = task;
    this.currentIteration = 0;
    this.iterations = [];
    this.state = "running";
    this.startTime = new Date();

    // 设置任务上下文
    this.intentGate.setTaskContext(this.intentGate.extractContext(task));

    // 初始化 todo 列表
    if (todos) {
      for (const todo of todos) {
        this.todoEnforcer.createTodo(todo.description, {
          priority: todo.priority,
          dependencies: todo.dependencies,
        });
      }
    } else {
      // 尝试从任务解析 todo
      this.todoEnforcer.parseTodosFromText(task);
    }

    const totalTodos = this.todoEnforcer.getAllTodos().length;
    this.emit("loop_started", task, totalTodos);

    // 执行循环
    try {
      await this.runLoop();
    } catch (error) {
      this.state = "failed";
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    }

    return this.generateSummary();
  }

  /**
   * 暂停循环
   */
  pause(reason: string = "User requested"): void {
    if (this.state !== "running") return;
    
    this.state = "paused";
    this.pauseReason = reason;
    this.emit("loop_paused", reason);
  }

  /**
   * 恢复循环
   */
  resume(): void {
    if (this.state !== "paused") return;

    this.state = "running";
    delete this.pauseReason;
    this.emit("loop_resumed");
    
    // 继续执行
    this.runLoop().catch((error) => {
      this.state = "failed";
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    });
  }

  /**
   * 取消循环
   */
  cancel(): void {
    this.state = "cancelled";
    this.emit("loop_completed", this.generateSummary());
  }

  // ============================================
  // 循环执行
  // ============================================

  /**
   * 执行主循环
   */
  private async runLoop(): Promise<void> {
    while (this.shouldContinue()) {
      // 检查暂停
      if (this.state === "paused") {
        return; // 等待恢复
      }

      // 检查超时
      if (this.isTimedOut()) {
        this.state = "failed";
        this.emit("error", new Error("Total timeout exceeded"));
        return;
      }

      // 创建迭代记录
      const iteration = this.createIteration();
      this.emit("iteration_started", iteration);

      try {
        // 获取下一个 todo
        const nextTodo = this.todoEnforcer.getNextTodo();
        
        if (!nextTodo) {
          // 没有待处理的 todo，检查是否全部完成
          const progress = this.todoEnforcer.getProgress();
          if (progress.completed === progress.total) {
            this.state = "completed";
          } else {
            // 有阻塞项
            this.state = "failed";
            iteration.outcome = "blocked";
            iteration.notes = "Some todos are blocked";
          }
        } else {
          iteration.todo = nextTodo;
          
          // 执行步骤
          const outcome = await this.executeStep(nextTodo, iteration);
          iteration.outcome = outcome;
          
          this.emit("step_executed", nextTodo, outcome);
        }
      } catch (error) {
        iteration.outcome = "failed";
        iteration.notes = error instanceof Error ? error.message : String(error);
        this.emit("error", error instanceof Error ? error : new Error(String(error)), iteration);
      }

      // 完成迭代
      this.completeIteration(iteration);
      this.emit("iteration_completed", iteration);

      // 懒惰检测
      if (this.config.enableLazyDetection && this.currentIteration % this.config.lazyCheckInterval === 0) {
        const lazyDetection = this.detectLazy();
        if (lazyDetection.isLazy) {
          this.emit("lazy_detected", lazyDetection);
        }
      }

      // 迭代延迟
      if (this.config.iterationDelay > 0) {
        await this.delay(this.config.iterationDelay);
      }
    }

    // 循环结束
    const summary = this.generateSummary();
    this.emit("loop_completed", summary);
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    todo: TodoItem,
    iteration: LoopIteration
  ): Promise<StepOutcome> {
    // 标记为进行中
    this.todoEnforcer.updateStatus(todo.id, "in_progress");

    let retries = 0;
    let lastOutcome: StepOutcome = "failed";

    while (retries <= (this.config.autoRetryFailed ? this.config.maxRetries : 0)) {
      // 检查意图
      if (this.config.enableIntentGate) {
        const action: ActionRecord = {
          type: "execute_todo",
          description: todo.description,
          target: todo.id,
          timestamp: new Date(),
        };

        const intentResult = this.intentGate.checkIntent(action);
        iteration.intentResults.push(intentResult);

        if (intentResult.verdict === "rejected") {
          this.todoEnforcer.enforceBlock(todo.id, intentResult.reason);
          return "blocked";
        }
      }

      try {
        // 执行步骤（这里需要外部执行器）
        // 实际执行由 executeAction 回调处理
        lastOutcome = await this.performAction(todo, iteration);
        
        if (lastOutcome === "success") {
          this.todoEnforcer.updateStatus(todo.id, "completed");
          return "success";
        }

        if (lastOutcome === "partial") {
          this.todoEnforcer.updateStatus(todo.id, "completed", "Partial completion");
          return "partial";
        }

        // 失败
        if (this.config.autoRetryFailed && retries < this.config.maxRetries) {
          retries++;
          await this.delay(1000 * retries); // 指数退避
          continue;
        }

        this.todoEnforcer.updateStatus(todo.id, "blocked", `Failed after ${retries} retries`);
        return "failed";
      } catch (error) {
        iteration.notes = error instanceof Error ? error.message : String(error);
        
        if (this.config.autoRetryFailed && retries < this.config.maxRetries) {
          retries++;
          await this.delay(1000 * retries);
          continue;
        }

        return "failed";
      }
    }

    return lastOutcome;
  }

  /**
   * 执行实际动作
   * 子类可以覆盖此方法来提供具体的执行逻辑
   */
  protected async performAction(
    todo: TodoItem,
    iteration: LoopIteration
  ): Promise<StepOutcome> {
    // 默认实现：记录动作并返回成功
    iteration.actions.push({
      type: "todo_action",
      description: todo.description,
      timestamp: new Date(),
    });

    // 这里应该由外部执行器来处理
    // 目前返回成功以便循环继续
    return "success";
  }

  // ============================================
  // 辅助方法
  // ============================================

  /**
   * 创建迭代记录
   */
  private createIteration(): LoopIteration {
    return {
      iteration: ++this.currentIteration,
      actions: [],
      intentResults: [],
      outcome: "success",
      startTime: new Date(),
    };
  }

  /**
   * 完成迭代记录
   */
  private completeIteration(iteration: LoopIteration): void {
    iteration.endTime = new Date();
    iteration.duration = iteration.endTime.getTime() - iteration.startTime.getTime();
    this.iterations.push(iteration);
  }

  /**
   * 检查是否应该继续
   */
  private shouldContinue(): boolean {
    if (this.state === "completed" || this.state === "failed" || this.state === "cancelled") {
      return false;
    }

    if (this.currentIteration >= this.config.maxIterations) {
      this.state = "failed";
      return false;
    }

    return true;
  }

  /**
   * 检查是否超时
   */
  private isTimedOut(): boolean {
    if (!this.startTime) return false;
    return Date.now() - this.startTime.getTime() > this.config.totalTimeout;
  }

  /**
   * 检测懒惰行为
   */
  private detectLazy(): LazyDetection {
    const recentIterations = this.iterations.slice(-this.config.lazyCheckInterval);
    const evidence: string[] = [];
    let lazyType: LazyDetection["type"] = "none";

    // 检测卡住
    const allBlocked = recentIterations.every((i) => i.outcome === "blocked");
    if (allBlocked && recentIterations.length >= this.config.lazyCheckInterval) {
      lazyType = "stuck";
      evidence.push(`Last ${this.config.lazyCheckInterval} iterations are all blocked`);
    }

    // 检测重复
    if (recentIterations.length >= 3) {
      const descriptions = recentIterations.map((i) => i.todo?.description).filter(Boolean);
      const uniqueDescriptions = new Set(descriptions);
      if (uniqueDescriptions.size === 1 && descriptions.length >= 3) {
        lazyType = "repeating";
        evidence.push(`Repeating the same todo: ${descriptions[0]}`);
      }
    }

    // 检测回避（跳过困难的 todo）
    const skippedCount = recentIterations.filter((i) => i.outcome === "skipped").length;
    if (skippedCount >= this.config.lazyCheckInterval / 2) {
      lazyType = "avoiding";
      evidence.push(`${skippedCount} out of ${this.config.lazyCheckInterval} iterations were skipped`);
    }

    // 检测拖延（没有实际进展）
    const progress = this.todoEnforcer.getProgress();
    if (progress.inProgress > 3 && progress.completed < progress.total * 0.1) {
      lazyType = "procrastinating";
      evidence.push(`Many todos in progress (${progress.inProgress}) but few completed (${progress.completed})`);
    }

    return {
      isLazy: lazyType !== "none",
      type: lazyType,
      evidence,
      forcedActions: this.generateForcedActions(lazyType),
    };
  }

  /**
   * 生成强制措施
   */
  private generateForcedActions(lazyType: LazyDetection["type"]): string[] {
    switch (lazyType) {
      case "stuck":
        return ["Request user clarification", "Try alternative approach", "Break down task further"];
      case "repeating":
        return ["Force complete current todo", "Escalate to human", "Switch strategy"];
      case "avoiding":
        return ["Block skipping", "Force tackle difficult todos first"];
      case "procrastinating":
        return ["Set stricter deadlines", "Reduce scope", "Focus on one task at a time"];
      default:
        return [];
    }
  }

  /**
   * 生成摘要
   */
  private generateSummary(): RalphLoopSummary {
    const successfulIterations = this.iterations.filter((i) => i.outcome === "success").length;
    const failedIterations = this.iterations.filter((i) => i.outcome === "failed").length;
    const progress = this.todoEnforcer.getProgress();

    return {
      task: this.currentTask,
      totalIterations: this.currentIteration,
      successfulIterations,
      failedIterations,
      totalTime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      completionRate: progress.percentage / 100,
      lazyDetections: this.iterations.filter((i) => i.notes?.includes("lazy")).length,
      intentRejections: this.iterations.reduce(
        (sum, i) => sum + i.intentResults.filter((r) => r.verdict === "rejected").length,
        0
      ),
      finalState: this.state,
      iterations: this.iterations,
    };
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================
  // Getter
  // ============================================

  /**
   * 获取当前状态
   */
  getState(): LoopState {
    return this.state;
  }

  /**
   * 获取当前迭代
   */
  getCurrentIteration(): number {
    return this.currentIteration;
  }

  /**
   * 获取 TodoEnforcer
   */
  getTodoEnforcer(): TodoEnforcer {
    return this.todoEnforcer;
  }

  /**
   * 获取 IntentGate
   */
  getIntentGate(): IntentGate {
    return this.intentGate;
  }

  // ============================================
  // 状态持久化
  // ============================================

  /**
   * 保存当前状态到快照
   */
  async saveState(metadata?: Record<string, unknown>): Promise<RalphLoopSnapshot> {
    const snapshot: RalphLoopSnapshot = {
      id: this.currentSnapshotId ?? generateSnapshotId(),
      timestamp: new Date(),
      task: this.currentTask,
      state: this.state,
      currentIteration: this.currentIteration,
      startTime: this.startTime ?? null,
      pauseReason: this.pauseReason ?? null,
      iterations: this.iterations.map(serializeIteration),
      todos: this.todoEnforcer.getAllTodos().map((t): SerializedTodoItem => ({
        id: t.id,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dependencies: t.dependencies,
        createdAt: t.createdAt.toISOString(),
        startedAt: t.startedAt?.toISOString() ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
        notes: t.notes,
      })),
      intentHistory: {
        actionHistory: this.intentGate.getActionHistory(),
        lowConfidenceHistory: this.intentGate.getLowConfidenceHistory(),
        driftCounter: this.intentGate.getDriftCount(),
        taskContext: this.intentGate.extractContext(this.currentTask),
      },
      config: {
        maxIterations: this.config.maxIterations,
        stepTimeout: this.config.stepTimeout,
        totalTimeout: this.config.totalTimeout,
        lazyCheckInterval: this.config.lazyCheckInterval,
        enableLazyDetection: this.config.enableLazyDetection,
        enableIntentGate: this.config.enableIntentGate,
        autoRetryFailed: this.config.autoRetryFailed,
        maxRetries: this.config.maxRetries,
        iterationDelay: this.config.iterationDelay,
      },
      ...(metadata ? { metadata } : {}),
    };

    await this.stateStore.save(snapshot);
    this.currentSnapshotId = snapshot.id;
    
    return snapshot;
  }

  /**
   * 从快照恢复状态
   */
  async loadState(snapshotId?: string): Promise<boolean> {
    const snapshot = snapshotId
      ? await this.stateStore.load(snapshotId)
      : await this.stateStore.getLatest();

    if (!snapshot) {
      return false;
    }

    // 恢复状态
    this.currentSnapshotId = snapshot.id;
    this.currentTask = snapshot.task;
    this.state = snapshot.state;
    this.currentIteration = snapshot.currentIteration;
    if (snapshot.startTime) {
      this.startTime = new Date(snapshot.startTime);
    }
    if (snapshot.pauseReason) {
      this.pauseReason = snapshot.pauseReason;
    }

    // 恢复迭代历史
    this.iterations = snapshot.iterations.map(deserializeIteration);
    
    // 恢复 Todo 列表
    this.todoEnforcer.deserialize(snapshot.todos);
    
    // 恢复 IntentGate 状态
    if (snapshot.intentHistory.taskContext) {
      this.intentGate.setTaskContext(snapshot.intentHistory.taskContext);
    }
    
    // 恢复配置
    this.config = {
      ...snapshot.config,
    };

    return true;
  }

  /**
   * 获取所有快照列表
   */
  async listSnapshots(): Promise<RalphLoopSnapshot[]> {
    return this.stateStore.list();
  }

  /**
   * 获取最新快照
   */
  async getLatestSnapshot(): Promise<RalphLoopSnapshot | null> {
    return this.stateStore.getLatest();
  }

  /**
   * 删除快照
   */
  async deleteSnapshot(id: string): Promise<boolean> {
    return this.stateStore.delete(id);
  }

  /**
   * 清除所有快照
   */
  async clearSnapshots(): Promise<void> {
    await this.stateStore.clear();
  }

  /**
   * 获取当前快照 ID
   */
  getCurrentSnapshotId(): string | undefined {
    return this.currentSnapshotId;
  }

  /**
   * 从暂停状态自动恢复（如果有保存的状态）
   */
  async autoResume(): Promise<boolean> {
    // 只在 idle 状态下才能自动恢复
    if (this.state !== "idle") {
      return false;
    }

    const loaded = await this.loadState();
    if (!loaded) {
      return false;
    }

    // 获取 loadState 设置的当前状态（TypeScript 无法追踪这种变化）
    const snapshotState = this.state as LoopState;
    
    // 如果之前是暂停状态，继续执行
    if (snapshotState === "paused") {
      this.state = "running";
      this.pauseReason = undefined;
      this.emit("loop_resumed");
      
      this.runLoop().catch((error) => {
        this.state = "failed";
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      });
      
      return true;
    }

    return false;
  }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 RalphLoop
 */
export function createRalphLoop(
  todoEnforcer?: TodoEnforcer,
  intentGate?: IntentGate,
  config?: Partial<RalphLoopConfig>,
  stateStoreConfig?: StateStoreConfig
): RalphLoop {
  return new RalphLoop(todoEnforcer, intentGate, config, stateStoreConfig);
}
