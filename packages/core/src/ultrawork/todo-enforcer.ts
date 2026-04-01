/**
 * TodoEnforcer - 任务强制器
 *
 * 基于 OMO (Oh My OpenCode) 设计
 * 
 * 确保任务有明确的 todo 列表并强制执行：
 * - 验证 todo 列表是否存在
 * - 检查 todo 项的明确性
 * - 追踪 todo 完成状态
 * - 强制 Agent 按计划执行
 */

import EventEmitter from "eventemitter3";

// ============================================
// 类型定义
// ============================================

/**
 * Todo 项状态
 */
export type TodoStatus = "pending" | "in_progress" | "completed" | "blocked";

/**
 * Todo 项
 */
export interface TodoItem {
  /** 唯一标识 */
  id: string;
  /** 描述 */
  description: string;
  /** 状态 */
  status: TodoStatus;
  /** 优先级 */
  priority: "low" | "normal" | "high" | "critical";
  /** 依赖项 */
  dependencies: string[];
  /** 创建时间 */
  createdAt: Date;
  /** 开始时间 */
  startedAt?: Date | undefined;
  /** 完成时间 */
  completedAt?: Date | undefined;
  /** 备注 */
  notes?: string | undefined;
}

/**
 * Todo 列表验证结果
 */
export interface TodoValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 严重程度 */
  severity: "error" | "warning" | "info";
  /** 问题描述 */
  issues: TodoIssue[];
  /** 建议的修复 */
  suggestions: string[];
}

/**
 * Todo 问题
 */
export interface TodoIssue {
  /** 问题类型 */
  type: "missing" | "ambiguous" | "blocked" | "stale" | "out_of_order";
  /** 相关的 todo ID */
  todoId?: string;
  /** 描述 */
  description: string;
}

/**
 * TodoEnforcer 事件
 */
export interface TodoEnforcerEvents {
  /** Todo 创建 */
  todo_created: (todo: TodoItem) => void;
  /** Todo 状态变更 */
  todo_updated: (todo: TodoItem, oldStatus: TodoStatus) => void;
  /** 验证完成 */
  validated: (result: TodoValidationResult) => void;
  /** 强制执行 */
  enforced: (action: string, todo: TodoItem) => void;
  /** 阻塞检测 */
  blocked_detected: (todo: TodoItem, reason: string) => void;
}

/**
 * TodoEnforcer 配置
 */
export interface TodoEnforcerConfig {
  /** 是否强制要求 todo 列表 */
  requireTodos: boolean;
  /** todo 项描述最小长度 */
  minDescriptionLength: number;
  /** 最大挂起时间（毫秒） */
  maxPendingTime: number;
  /** 最大进行中时间（毫秒） */
  maxInProgressTime: number;
  /** 是否自动检测阻塞 */
  autoDetectBlocked: boolean;
  /** 阻塞检测阈值（迭代次数） */
  blockedThreshold: number;
}

// ============================================
// TodoEnforcer 实现
// ============================================

/**
 * 任务强制器
 */
export class TodoEnforcer extends EventEmitter<TodoEnforcerEvents> {
  private todos: Map<string, TodoItem> = new Map();
  private config: Required<TodoEnforcerConfig>;
  private idCounter = 0;

  constructor(config: Partial<TodoEnforcerConfig> = {}) {
    super();
    this.config = {
      requireTodos: config.requireTodos ?? true,
      minDescriptionLength: config.minDescriptionLength ?? 10,
      maxPendingTime: config.maxPendingTime ?? 300000, // 5 分钟
      maxInProgressTime: config.maxInProgressTime ?? 600000, // 10 分钟
      autoDetectBlocked: config.autoDetectBlocked ?? true,
      blockedThreshold: config.blockedThreshold ?? 5,
    };
  }

  // ============================================
  // Todo 管理
  // ============================================

  /**
   * 创建 Todo
   */
  createTodo(
    description: string,
    options: Partial<Omit<TodoItem, "id" | "description" | "createdAt">> = {}
  ): TodoItem {
    const todo: TodoItem = {
      id: `todo_${Date.now()}_${++this.idCounter}`,
      description,
      status: options.status ?? "pending",
      priority: options.priority ?? "normal",
      dependencies: options.dependencies ?? [],
      createdAt: new Date(),
      ...options,
    };

    this.todos.set(todo.id, todo);
    this.emit("todo_created", todo);

    return todo;
  }

  /**
   * 从文本解析 Todo 列表
   */
  parseTodosFromText(text: string): TodoItem[] {
    const lines = text.split("\n");
    const todos: TodoItem[] = [];

    // 匹配 markdown 风格的 todo
    const todoPattern = /^[-*]\s*\[([ x])\]\s*(.+)$/;

    for (const line of lines) {
      const match = line.match(todoPattern);
      if (match) {
        const isCompleted = match[1] === "x";
        const description = match[2]!.trim();

        const todo = this.createTodo(description, {
          status: isCompleted ? "completed" : "pending",
          ...(isCompleted ? { completedAt: new Date() } : {}),
        });
        todos.push(todo);
      }
    }

    return todos;
  }

  /**
   * 更新 Todo 状态
   */
  updateStatus(id: string, status: TodoStatus, notes?: string): TodoItem | undefined {
    const todo = this.todos.get(id);
    if (!todo) return undefined;

    const oldStatus = todo.status;
    todo.status = status;

    if (status === "in_progress" && !todo.startedAt) {
      todo.startedAt = new Date();
    }

    if (status === "completed") {
      todo.completedAt = new Date();
    }

    if (notes) {
      todo.notes = notes;
    }

    this.emit("todo_updated", todo, oldStatus);
    return todo;
  }

  /**
   * 获取 Todo
   */
  getTodo(id: string): TodoItem | undefined {
    return this.todos.get(id);
  }

  /**
   * 获取所有 Todo
   */
  getAllTodos(): TodoItem[] {
    return Array.from(this.todos.values());
  }

  /**
   * 获取待处理的 Todo
   */
  getPendingTodos(): TodoItem[] {
    return this.getAllTodos().filter((t) => t.status === "pending");
  }

  /**
   * 获取进行中的 Todo
   */
  getInProgressTodos(): TodoItem[] {
    return this.getAllTodos().filter((t) => t.status === "in_progress");
  }

  /**
   * 获取下一个可执行的 Todo
   */
  getNextTodo(): TodoItem | undefined {
    const pending = this.getPendingTodos();

    // 按优先级排序
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    pending.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // 找到没有阻塞依赖的
    for (const todo of pending) {
      const dependenciesMet = todo.dependencies.every((depId) => {
        const dep = this.todos.get(depId);
        return dep?.status === "completed";
      });

      if (dependenciesMet) {
        return todo;
      }
    }

    return undefined;
  }

  // ============================================
  // 验证
  // ============================================

  /**
   * 验证 Todo 列表
   */
  validate(): TodoValidationResult {
    const issues: TodoIssue[] = [];
    const suggestions: string[] = [];

    // 检查是否有 todo
    if (this.config.requireTodos && this.todos.size === 0) {
      issues.push({
        type: "missing",
        description: "No todo list found. Create a todo list before starting work.",
      });
      suggestions.push("Create a todo list with clear, actionable items.");
    }

    // 检查每个 todo
    for (const todo of this.todos.values()) {
      // 检查描述清晰度
      if (todo.description.length < this.config.minDescriptionLength) {
        issues.push({
          type: "ambiguous",
          todoId: todo.id,
          description: `Todo "${todo.description}" is too short. Be more specific.`,
        });
      }

      // 检查模糊词汇
      const vagueWords = ["do", "fix", "handle", "implement", "update"];
      if (vagueWords.some((word) => todo.description.toLowerCase().startsWith(word + " "))) {
        issues.push({
          type: "ambiguous",
          todoId: todo.id,
          description: `Todo "${todo.description}" starts with a vague verb. Be more specific.`,
        });
        suggestions.push(`Refine "${todo.description}" to be more specific about what needs to be done.`);
      }

      // 检查阻塞状态
      if (todo.status === "blocked") {
        issues.push({
          type: "blocked",
          todoId: todo.id,
          description: `Todo "${todo.description}" is blocked.`,
        });
      }

      // 检查过期
      if (todo.status === "in_progress" && todo.startedAt) {
        const elapsed = Date.now() - todo.startedAt.getTime();
        if (elapsed > this.config.maxInProgressTime) {
          issues.push({
            type: "stale",
            todoId: todo.id,
            description: `Todo "${todo.description}" has been in progress for too long.`,
          });
        }
      }
    }

    // 确定严重程度
    let severity: "error" | "warning" | "info" = "info";
    if (issues.some((i) => i.type === "missing" || i.type === "blocked")) {
      severity = "error";
    } else if (issues.length > 0) {
      severity = "warning";
    }

    const result: TodoValidationResult = {
      valid: issues.length === 0,
      severity,
      issues,
      suggestions,
    };

    this.emit("validated", result);
    return result;
  }

  // ============================================
  // 强制执行
  // ============================================

  /**
   * 强制执行下一个 Todo
   */
  enforceNext(): TodoItem | undefined {
    const next = this.getNextTodo();
    if (!next) return undefined;

    this.updateStatus(next.id, "in_progress");
    this.emit("enforced", "start", next);

    return next;
  }

  /**
   * 强制完成当前 Todo
   */
  enforceComplete(id: string): TodoItem | undefined {
    const todo = this.todos.get(id);
    if (!todo || todo.status === "completed") return undefined;

    this.updateStatus(id, "completed");
    this.emit("enforced", "complete", todo);

    return todo;
  }

  /**
   * 强制阻塞 Todo
   */
  enforceBlock(id: string, reason: string): TodoItem | undefined {
    const todo = this.todos.get(id);
    if (!todo) return undefined;

    const oldStatus = todo.status;
    todo.status = "blocked";
    todo.notes = reason;

    this.emit("todo_updated", todo, oldStatus);
    this.emit("blocked_detected", todo, reason);

    return todo;
  }

  // ============================================
  // 统计
  // ============================================

  /**
   * 获取进度统计
   */
  getProgress(): {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    blocked: number;
    percentage: number;
  } {
    const all = this.getAllTodos();
    const pending = all.filter((t) => t.status === "pending").length;
    const inProgress = all.filter((t) => t.status === "in_progress").length;
    const completed = all.filter((t) => t.status === "completed").length;
    const blocked = all.filter((t) => t.status === "blocked").length;
    const total = all.length;

    return {
      total,
      pending,
      inProgress,
      completed,
      blocked,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  /**
   * 清除所有 Todo
   */
  clear(): void {
    this.todos.clear();
  }

  // ============================================
  // 序列化
  // ============================================

  /**
   * 序列化所有 Todo 为 JSON 兼容格式
   */
  serialize(): Array<Omit<TodoItem, 'createdAt' | 'startedAt' | 'completedAt'> & {
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  }> {
    return this.getAllTodos().map(todo => {
      const result: Omit<TodoItem, 'createdAt' | 'startedAt' | 'completedAt'> & {
        createdAt: string;
        startedAt: string | null;
        completedAt: string | null;
      } = {
        id: todo.id,
        description: todo.description,
        status: todo.status,
        priority: todo.priority,
        dependencies: todo.dependencies,
        createdAt: todo.createdAt.toISOString(),
        startedAt: todo.startedAt?.toISOString() ?? null,
        completedAt: todo.completedAt?.toISOString() ?? null,
      };
      if (todo.notes !== undefined) {
        result.notes = todo.notes;
      }
      return result;
    });
  }

  /**
   * 从序列化数据恢复 Todo 列表
   */
  deserialize(data: Array<{
    id: string;
    description: string;
    status: TodoStatus;
    priority: "low" | "normal" | "high" | "critical";
    dependencies: string[];
    createdAt: string;
    startedAt?: string | null | undefined;
    completedAt?: string | null | undefined;
    notes?: string | undefined;
  }>): void {
    this.todos.clear();

    for (const item of data) {
      const todo: TodoItem = {
        id: item.id,
        description: item.description,
        status: item.status,
        priority: item.priority,
        dependencies: item.dependencies,
        createdAt: new Date(item.createdAt),
      };
      if (item.startedAt) {
        todo.startedAt = new Date(item.startedAt);
      }
      if (item.completedAt) {
        todo.completedAt = new Date(item.completedAt);
      }
      if (item.notes !== undefined) {
        todo.notes = item.notes;
      }
      this.todos.set(todo.id, todo);
    }
  }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 TodoEnforcer
 */
export function createTodoEnforcer(
  config?: Partial<TodoEnforcerConfig>
): TodoEnforcer {
  return new TodoEnforcer(config);
}
