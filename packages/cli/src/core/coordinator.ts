/**
 * 并行代理协调器 - Coordinator 模式
 *
 * 参考 Claude Code Coordinator 设计：
 * 1. Synthesize: 理解任务，规划子任务
 * 2. Delegate: 分配子任务给代理
 * 3. Collect: 收集各代理结果
 * 4. Synthesize: 合成最终答案
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 代理类型
 */
export type AgentType =
  | "general-purpose"
  | "explore-agent"
  | "plan-agent"
  | "code-reviewer"
  | "frontend-tester"
  | "backend-architect"
  | "python-pro"
  | "typescript-pro"
  | "rust-pro";

/**
 * 子任务
 */
export interface SubTask {
  /** 任务 ID */
  id: string;
  /** 任务描述 */
  description: string;
  /** 代理类型 */
  agent: AgentType;
  /** 依赖的任务 ID */
  dependencies?: string[];
  /** 优先级 */
  priority?: "high" | "medium" | "low";
}

/**
 * 子任务结果
 */
export interface SubTaskResult {
  /** 任务 ID */
  taskId: string;
  /** 是否成功 */
  success: boolean;
  /** 结果内容 */
  content: string;
  /** 错误信息 */
  error?: string;
  /** 执行时长 (ms) */
  duration: number;
}

/**
 * 协调计划
 */
export interface CoordinatorPlan {
  /** 原始任务 */
  task: string;
  /** 子任务列表 */
  subTasks: SubTask[];
  /** 执行模式 */
  mode: "sequential" | "parallel" | "hierarchical";
}

/**
 * 协调结果
 */
export interface CoordinatorResult {
  /** 合成结果 */
  synthesis: string;
  /** 子任务结果 */
  subResults: Map<string, SubTaskResult>;
  /** 总执行时长 */
  totalDuration: number;
}

/**
 * 代理执行函数类型
 */
export type AgentExecutor = (task: string, agent: AgentType) => Promise<string>;

/**
 * 协调器配置
 */
export interface CoordinatorConfig {
  /** 最大并行数 */
  maxParallel?: number;
  /** 超时时间 (ms) */
  timeout?: number;
  /** 是否启用日志 */
  debug?: boolean;
}

// ============================================================================
// 协调器
// ============================================================================

/**
 * 并行代理协调器
 */
export class Coordinator {
  private maxParallel: number;
  private timeout: number;
  private debug: boolean;

  constructor(config: CoordinatorConfig = {}) {
    this.maxParallel = config.maxParallel ?? 3;
    this.timeout = config.timeout ?? 60000;
    this.debug = config.debug ?? false;
  }

  /**
   * 执行任务
   *
   * @param task 任务描述
   * @param executor 代理执行函数
   * @returns 协调结果
   */
  async execute(task: string, executor: AgentExecutor): Promise<CoordinatorResult> {
    const startTime = Date.now();

    // 1. 规划任务
    const plan = await this.plan(task);

    if (this.debug) {
      console.log(`[Coordinator] Plan: ${plan.subTasks.length} sub-tasks`);
    }

    // 2. 执行子任务
    const subResults = await this.delegate(plan, executor);

    // 3. 合成结果
    const synthesis = await this.synthesize(task, subResults);

    const totalDuration = Date.now() - startTime;

    return {
      synthesis,
      subResults,
      totalDuration,
    };
  }

  /**
   * 规划任务
   *
   * 将复杂任务分解为可执行的子任务
   */
  private async plan(task: string): Promise<CoordinatorPlan> {
    // 简单的任务分解逻辑
    // 实际应该使用 LLM 进行智能分解

    const subTasks: SubTask[] = [];

    // 检测任务类型
    if (task.includes("分析") || task.includes("理解") || task.includes("探索")) {
      subTasks.push({
        id: "explore",
        description: `探索和分析: ${task}`,
        agent: "explore-agent",
        priority: "high",
      });
    }

    if (task.includes("实现") || task.includes("开发") || task.includes("写代码")) {
      subTasks.push({
        id: "implement",
        description: `实现功能: ${task}`,
        agent: "general-purpose",
        priority: "high",
        dependencies: subTasks.length > 0 ? [subTasks[subTasks.length - 1]!.id] : undefined,
      });
    }

    if (task.includes("测试") || task.includes("验证")) {
      subTasks.push({
        id: "test",
        description: `测试和验证: ${task}`,
        agent: "frontend-tester",
        priority: "medium",
        dependencies: subTasks.length > 0 ? [subTasks[subTasks.length - 1]!.id] : undefined,
      });
    }

    if (task.includes("审查") || task.includes("检查")) {
      subTasks.push({
        id: "review",
        description: `代码审查: ${task}`,
        agent: "code-reviewer",
        priority: "medium",
      });
    }

    // 默认任务
    if (subTasks.length === 0) {
      subTasks.push({
        id: "main",
        description: task,
        agent: "general-purpose",
        priority: "high",
      });
    }

    return {
      task,
      subTasks,
      mode: subTasks.some((s) => s.dependencies) ? "hierarchical" : "parallel",
    };
  }

  /**
   * 分配和执行子任务
   */
  private async delegate(
    plan: CoordinatorPlan,
    executor: AgentExecutor
  ): Promise<Map<string, SubTaskResult>> {
    const results = new Map<string, SubTaskResult>();

    if (plan.mode === "parallel") {
      // 并行执行所有子任务
      const promises = plan.subTasks.map((subTask) =>
        this.executeSubTask(subTask, executor)
      );

      const subResults = await Promise.all(promises);
      subResults.forEach((r) => results.set(r.taskId, r));
    } else {
      // 按依赖顺序执行
      const executed = new Set<string>();

      while (executed.size < plan.subTasks.length) {
        // 找到可执行的任务
        const ready = plan.subTasks.filter(
          (s) =>
            !executed.has(s.id) &&
            (!s.dependencies || s.dependencies.every((d) => executed.has(d)))
        );

        if (ready.length === 0) {
          // 循环依赖，强制执行剩余任务
          const remaining = plan.subTasks.filter((s) => !executed.has(s.id));
          if (remaining.length > 0) {
            const result = await this.executeSubTask(remaining[0]!, executor);
            results.set(result.taskId, result);
            executed.add(remaining[0]!.id);
          }
          break;
        }

        // 并行执行就绪任务
        const promises = ready.slice(0, this.maxParallel).map((subTask) =>
          this.executeSubTask(subTask, executor)
        );

        const subResults = await Promise.all(promises);
        subResults.forEach((r) => {
          results.set(r.taskId, r);
          executed.add(r.taskId);
        });
      }
    }

    return results;
  }

  /**
   * 执行单个子任务
   */
  private async executeSubTask(
    subTask: SubTask,
    executor: AgentExecutor
  ): Promise<SubTaskResult> {
    const startTime = Date.now();

    try {
      if (this.debug) {
        console.log(`[Coordinator] Executing: ${subTask.id} (${subTask.agent})`);
      }

      const content = await executor(subTask.description, subTask.agent);
      const duration = Date.now() - startTime;

      return {
        taskId: subTask.id,
        success: true,
        content,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      return {
        taskId: subTask.id,
        success: false,
        content: "",
        error: error instanceof Error ? error.message : String(error),
        duration,
      };
    }
  }

  /**
   * 合成结果
   */
  private async synthesize(
    task: string,
    subResults: Map<string, SubTaskResult>
  ): Promise<string> {
    // 简单的结果合成
    // 实际应该使用 LLM 进行智能合成

    const parts: string[] = [];

    for (const [id, result] of subResults) {
      if (result.success) {
        parts.push(`### ${id}\n\n${result.content}`);
      } else {
        parts.push(`### ${id} (失败)\n\n错误: ${result.error}`);
      }
    }

    if (parts.length === 0) {
      return "任务执行完成，但没有产生结果。";
    }

    return parts.join("\n\n---\n\n");
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建协调器
 */
export function createCoordinator(config?: CoordinatorConfig): Coordinator {
  return new Coordinator(config);
}

// ============================================================================
// 导出
// ============================================================================

export default Coordinator;
