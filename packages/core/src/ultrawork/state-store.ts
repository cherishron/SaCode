/**
 * State Store - 状态持久化存储
 *
 * 支持循环执行引擎的状态保存和恢复：
 * - 内存存储（默认）
 * - 文件存储
 * - 自定义存储后端
 */

import { mkdir, readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import type { TodoItem, TodoStatus } from "./todo-enforcer";
import type { LoopIteration, LoopState, StepOutcome } from "./ralph-loop";
import type { ActionRecord, LowConfidenceRecord, TaskContext } from "./intent-gate";

// ============================================
// 类型定义
// ============================================

/**
 * 序列化的 Todo 项（用于持久化）
 */
export interface SerializedTodoItem {
  id: string;
  description: string;
  status: TodoStatus;
  priority: "low" | "normal" | "high" | "critical";
  dependencies: string[];
  createdAt: string;
  startedAt?: string | null | undefined;
  completedAt?: string | null | undefined;
  notes?: string | undefined;
}

/**
 * RalphLoop 快照
 */
export interface RalphLoopSnapshot {
  /** 快照 ID */
  id: string;
  /** 快照时间 */
  timestamp: Date;
  /** 任务描述 */
  task: string;
  /** 循环状态 */
  state: LoopState;
  /** 当前迭代 */
  currentIteration: number;
  /** 开始时间 */
  startTime: Date | null;
  /** 暂停原因 */
  pauseReason: string | null;
  /** 迭代历史 */
  iterations: SerializedIteration[];
  /** Todo 列表（序列化） */
  todos: SerializedTodoItem[];
  /** 意图门控历史 */
  intentHistory: {
    actionHistory: ActionRecord[];
    lowConfidenceHistory: LowConfidenceRecord[];
    driftCounter: number;
    taskContext: TaskContext | null;
  };
  /** 配置 */
  config: {
    maxIterations: number;
    stepTimeout: number;
    totalTimeout: number;
    lazyCheckInterval: number;
    enableLazyDetection: boolean;
    enableIntentGate: boolean;
    autoRetryFailed: boolean;
    maxRetries: number;
    iterationDelay: number;
  };
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 序列化的迭代记录
 * （将 Date 转为字符串以便 JSON 序列化）
 */
export interface SerializedIteration {
  iteration: number;
  todo?: SerializedTodoItem;
  actions: ActionRecord[];
  intentResults: Array<{
    verdict: string;
    confidence: number;
    matchedKeywords: string[];
    mismatches: string[];
    suggestions: string[];
    reason: string;
  }>;
  outcome: StepOutcome;
  startTime: string;
  endTime?: string | null | undefined;
  duration?: number | null | undefined;
  notes?: string | null | undefined;
}

/**
 * 状态存储接口
 */
export interface IStateStore {
  /** 保存快照 */
  save(snapshot: RalphLoopSnapshot): Promise<void>;
  /** 加载快照 */
  load(id: string): Promise<RalphLoopSnapshot | null>;
  /** 获取最新快照 */
  getLatest(): Promise<RalphLoopSnapshot | null>;
  /** 列出所有快照 */
  list(): Promise<RalphLoopSnapshot[]>;
  /** 删除快照 */
  delete(id: string): Promise<boolean>;
  /** 清除所有快照 */
  clear(): Promise<void>;
  /** 是否存在快照 */
  exists(id: string): Promise<boolean>;
}

/**
 * 状态存储配置
 */
export interface StateStoreConfig {
  /** 存储类型 */
  type: "memory" | "file" | "custom";
  /** 存储路径（文件存储） */
  path?: string;
  /** 最大快照数量 */
  maxSnapshots?: number;
  /** 自定义存储实现 */
  customStore?: IStateStore;
}

// ============================================
// 内存存储实现
// ============================================

/**
 * 内存状态存储
 * 用于临时存储，进程重启后数据丢失
 */
export class MemoryStateStore implements IStateStore {
  private snapshots: Map<string, RalphLoopSnapshot> = new Map();
  private maxSnapshots: number;

  constructor(maxSnapshots: number = 10) {
    this.maxSnapshots = maxSnapshots;
  }

  async save(snapshot: RalphLoopSnapshot): Promise<void> {
    this.snapshots.set(snapshot.id, snapshot);
    
    // 清理旧快照
    if (this.snapshots.size > this.maxSnapshots) {
      const sorted = [...this.snapshots.values()].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const toDelete = sorted.slice(this.maxSnapshots);
      for (const s of toDelete) {
        this.snapshots.delete(s.id);
      }
    }
  }

  async load(id: string): Promise<RalphLoopSnapshot | null> {
    return this.snapshots.get(id) ?? null;
  }

  async getLatest(): Promise<RalphLoopSnapshot | null> {
    const snapshots = [...this.snapshots.values()];
    if (snapshots.length === 0) return null;
    
    return snapshots.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0] ?? null;
  }

  async list(): Promise<RalphLoopSnapshot[]> {
    return [...this.snapshots.values()].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  async delete(id: string): Promise<boolean> {
    return this.snapshots.delete(id);
  }

  async clear(): Promise<void> {
    this.snapshots.clear();
  }

  async exists(id: string): Promise<boolean> {
    return this.snapshots.has(id);
  }
}

// ============================================
// 文件存储实现
// ============================================

/**
 * 文件状态存储
 * 将快照持久化到文件系统
 */
export class FileStateStore implements IStateStore {
  private basePath: string;
  private maxSnapshots: number;

  constructor(basePath: string, maxSnapshots: number = 10) {
    this.basePath = basePath;
    this.maxSnapshots = maxSnapshots;
  }

  private getSnapshotPath(id: string): string {
    return join(this.basePath, `${id}.json`);
  }

  private getIndexFilePath(): string {
    return join(this.basePath, "index.json");
  }

  async ensureDirectory(): Promise<void> {
    try {
      await access(this.basePath);
    } catch {
      await mkdir(this.basePath, { recursive: true });
    }
  }

  async save(snapshot: RalphLoopSnapshot): Promise<void> {
    await this.ensureDirectory();
    
    const filePath = this.getSnapshotPath(snapshot.id);
    const content = JSON.stringify(snapshot, null, 2);
    await writeFile(filePath, content, "utf-8");
    
    // 更新索引
    await this.updateIndex();
    
    // 清理旧快照
    await this.cleanupOldSnapshots();
  }

  async load(id: string): Promise<RalphLoopSnapshot | null> {
    try {
      const filePath = this.getSnapshotPath(id);
      const content = await readFile(filePath, "utf-8");
      return this.deserializeSnapshot(content);
    } catch {
      return null;
    }
  }

  async getLatest(): Promise<RalphLoopSnapshot | null> {
    const snapshots = await this.list();
    return snapshots[0] ?? null;
  }

  async list(): Promise<RalphLoopSnapshot[]> {
    await this.ensureDirectory();
    
    try {
      const indexContent = await readFile(this.getIndexFilePath(), "utf-8");
      const index = JSON.parse(indexContent) as string[];
      const snapshots: RalphLoopSnapshot[] = [];
      
      for (const id of index) {
        const snapshot = await this.load(id);
        if (snapshot) {
          snapshots.push(snapshot);
        }
      }
      
      return snapshots.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch {
      return [];
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const filePath = this.getSnapshotPath(id);
      const { unlink } = await import("fs/promises");
      await unlink(filePath);
      await this.updateIndex();
      return true;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    await this.ensureDirectory();
    const snapshots = await this.list();
    
    const { unlink } = await import("fs/promises");
    for (const snapshot of snapshots) {
      try {
        await unlink(this.getSnapshotPath(snapshot.id));
      } catch {
        // 忽略删除错误
      }
    }
    
    try {
      await unlink(this.getIndexFilePath());
    } catch {
      // 忽略
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const filePath = this.getSnapshotPath(id);
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async updateIndex(): Promise<void> {
    const { readdir } = await import("fs/promises");
    const files = await readdir(this.basePath);
    const ids = files
      .filter(f => f.endsWith(".json") && f !== "index.json")
      .map(f => f.slice(0, -5));
    
    const indexContent = JSON.stringify(ids, null, 2);
    await writeFile(this.getIndexFilePath(), indexContent, "utf-8");
  }

  private async cleanupOldSnapshots(): Promise<void> {
    const snapshots = await this.list();
    
    if (snapshots.length > this.maxSnapshots) {
      const toDelete = snapshots.slice(this.maxSnapshots);
      for (const snapshot of toDelete) {
        await this.delete(snapshot.id);
      }
    }
  }

  private deserializeSnapshot(content: string): RalphLoopSnapshot {
    const parsed = JSON.parse(content);
    
    // 转换日期字段
    parsed.timestamp = new Date(parsed.timestamp);
    parsed.startTime = parsed.startTime ? new Date(parsed.startTime) : null;
    
    for (const iteration of parsed.iterations) {
      iteration.startTime = new Date(iteration.startTime);
      if (iteration.endTime) {
        iteration.endTime = new Date(iteration.endTime);
      }
    }
    
    return parsed;
  }
}

// ============================================
// 存储工厂
// ============================================

/**
 * 创建状态存储
 */
export function createStateStore(config: StateStoreConfig): IStateStore {
  switch (config.type) {
    case "memory":
      return new MemoryStateStore(config.maxSnapshots);
    case "file":
      return new FileStateStore(config.path ?? "./data/snapshots", config.maxSnapshots);
    case "custom":
      if (!config.customStore) {
        throw new Error("Custom store must be provided for custom type");
      }
      return config.customStore;
    default:
      throw new Error(`Unknown store type: ${config.type}`);
  }
}

// ============================================
// 工具函数
// ============================================

/**
 * 生成快照 ID
 */
export function generateSnapshotId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).substring(2, 8);
  return `snapshot-${timestamp}-${random}`;
}

/**
 * 序列化迭代记录
 */
export function serializeIteration(iteration: LoopIteration): SerializedIteration {
  let serializedTodo: SerializedTodoItem | undefined;
  if (iteration.todo) {
    serializedTodo = {
      id: iteration.todo.id,
      description: iteration.todo.description,
      status: iteration.todo.status,
      priority: iteration.todo.priority,
      dependencies: iteration.todo.dependencies,
      createdAt: iteration.todo.createdAt.toISOString(),
    };
    if (iteration.todo.startedAt !== undefined) {
      serializedTodo.startedAt = iteration.todo.startedAt.toISOString();
    } else {
      serializedTodo.startedAt = null;
    }
    if (iteration.todo.completedAt !== undefined) {
      serializedTodo.completedAt = iteration.todo.completedAt.toISOString();
    } else {
      serializedTodo.completedAt = null;
    }
    if (iteration.todo.notes !== undefined) {
      serializedTodo.notes = iteration.todo.notes;
    }
  }

  const result: SerializedIteration = {
    iteration: iteration.iteration,
    actions: iteration.actions,
    intentResults: iteration.intentResults.map(r => ({
      verdict: r.verdict,
      confidence: r.confidence,
      matchedKeywords: r.matchedKeywords,
      mismatches: r.mismatches,
      suggestions: r.suggestions,
      reason: r.reason,
    })),
    outcome: iteration.outcome,
    startTime: iteration.startTime.toISOString(),
  };
  
  if (serializedTodo !== undefined) {
    result.todo = serializedTodo;
  }
  if (iteration.endTime !== undefined) {
    result.endTime = iteration.endTime.toISOString();
  } else {
    result.endTime = undefined;
  }
  if (iteration.duration !== undefined) {
    result.duration = iteration.duration;
  }
  if (iteration.notes !== undefined) {
    result.notes = iteration.notes;
  }
  
  return result;
}

/**
 * 反序列化迭代记录
 */
export function deserializeIteration(serialized: SerializedIteration): LoopIteration {
  let deserializedTodo: TodoItem | undefined;
  if (serialized.todo) {
    deserializedTodo = {
      id: serialized.todo.id,
      description: serialized.todo.description,
      status: serialized.todo.status,
      priority: serialized.todo.priority,
      dependencies: serialized.todo.dependencies,
      createdAt: new Date(serialized.todo.createdAt),
    };
    if (serialized.todo.startedAt !== undefined && serialized.todo.startedAt !== null) {
      deserializedTodo.startedAt = new Date(serialized.todo.startedAt);
    }
    if (serialized.todo.completedAt !== undefined && serialized.todo.completedAt !== null) {
      deserializedTodo.completedAt = new Date(serialized.todo.completedAt);
    }
    if (serialized.todo.notes !== undefined) {
      deserializedTodo.notes = serialized.todo.notes;
    }
  }

  const result: LoopIteration = {
    iteration: serialized.iteration,
    actions: serialized.actions,
    intentResults: serialized.intentResults.map(r => ({
      verdict: r.verdict as "approved" | "warning" | "rejected" | "clarification",
      confidence: r.confidence,
      matchedKeywords: r.matchedKeywords,
      mismatches: r.mismatches,
      suggestions: r.suggestions,
      reason: r.reason,
    })),
    outcome: serialized.outcome,
    startTime: new Date(serialized.startTime),
  };
  
  if (deserializedTodo !== undefined) {
    result.todo = deserializedTodo;
  }
  if (serialized.endTime !== undefined && serialized.endTime !== null) {
    result.endTime = new Date(serialized.endTime);
  }
  if (serialized.duration !== undefined && serialized.duration !== null) {
    result.duration = serialized.duration;
  }
  if (serialized.notes !== undefined && serialized.notes !== null) {
    result.notes = serialized.notes;
  }
  
  return result;
}
