/**
 * 钩子执行器
 *
 * 负责执行单个钩子，处理超时、错误和结果
 */

import type {
  HookDefinition,
  HookContext,
  HookResult,
  HookExecutionLog,
  HookStats,
} from "./types";

/**
 * 执行器配置
 */
export interface HookExecutorConfig {
  /** 默认超时时间（毫秒） */
  defaultTimeout: number;
  /** 是否记录执行日志 */
  enableLogging: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_EXECUTOR_CONFIG: HookExecutorConfig = {
  defaultTimeout: 30000,
  enableLogging: true,
};

/**
 * 钩子执行器
 */
export class HookExecutor {
  private config: HookExecutorConfig;
  private stats: Map<string, HookStats> = new Map();
  private logs: HookExecutionLog[] = [];

  constructor(config: Partial<HookExecutorConfig> = {}) {
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  }

  /**
   * 执行单个钩子
   */
  async execute(
    hook: HookDefinition,
    context: HookContext
  ): Promise<HookResult> {
    const startTime = Date.now();
    const timeout = hook.timeout ?? this.config.defaultTimeout;

    // 检查钩子是否启用
    if (!hook.enabled) {
      return { proceed: true };
    }

    try {
      // 使用 Promise.race 实现超时
      const result = await Promise.race([
        this.executeHandler(hook, context),
        this.createTimeoutPromise(timeout, hook.name),
      ]);

      // 记录成功
      this.recordExecution(hook.name, context.event, startTime, true, result);

      return result;
    } catch (error) {
      // 记录失败
      const errorResult: HookResult = {
        proceed: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };

      this.recordExecution(
        hook.name,
        context.event,
        startTime,
        false,
        errorResult,
        error instanceof Error ? error.message : String(error)
      );

      // 钩子执行失败时，默认继续执行（安全策略）
      return { proceed: true, error: errorResult.error };
    }
  }

  /**
   * 执行钩子处理函数
   */
  private async executeHandler(
    hook: HookDefinition,
    context: HookContext
  ): Promise<HookResult> {
    try {
      const result = await Promise.resolve(hook.handler(context));
      
      // 确保返回有效的结果
      if (result && typeof result === "object" && "proceed" in result) {
        return result;
      }

      // 如果处理函数没有返回有效结果，默认继续
      return { proceed: true };
    } catch (error) {
      throw new Error(
        `Hook handler execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 创建超时 Promise
   */
  private createTimeoutPromise(
    timeout: number,
    hookName: string
  ): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Hook "${hookName}" execution timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * 记录执行日志
   */
  private recordExecution(
    hookName: string,
    event: HookContext["event"],
    startTime: number,
    success: boolean,
    result?: HookResult,
    error?: string
  ): void {
    if (!this.config.enableLogging) return;

    const duration = Date.now() - startTime;

    // 更新统计
    const stats = this.stats.get(hookName) ?? {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      avgExecutionTime: 0,
    };

    stats.totalExecutions++;
    if (success) {
      stats.successCount++;
    } else {
      stats.failureCount++;
    }
    stats.avgExecutionTime =
      (stats.avgExecutionTime * (stats.totalExecutions - 1) + duration) /
      stats.totalExecutions;
    stats.lastExecutedAt = new Date();

    this.stats.set(hookName, stats);

    // 记录日志
    const log: HookExecutionLog = {
      hookName,
      event,
      executedAt: new Date(),
      success,
      duration,
      result,
      error,
    };

    this.logs.push(log);

    // 限制日志数量
    if (this.logs.length > 1000) {
      this.logs.shift();
    }
  }

  /**
   * 获取钩子统计
   */
  getStats(hookName?: string): HookStats | Map<string, HookStats> {
    if (hookName) {
      return this.stats.get(hookName) ?? {
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        avgExecutionTime: 0,
      };
    }
    return new Map(this.stats);
  }

  /**
   * 获取执行日志
   */
  getLogs(options?: {
    hookName?: string;
    event?: HookContext["event"];
    limit?: number;
  }): HookExecutionLog[] {
    let logs = [...this.logs];

    if (options?.hookName) {
      logs = logs.filter((l) => l.hookName === options.hookName);
    }

    if (options?.event) {
      logs = logs.filter((l) => l.event === options.event);
    }

    if (options?.limit) {
      logs = logs.slice(-options.limit);
    }

    return logs;
  }

  /**
   * 清除日志
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats.clear();
  }
}

/**
 * 创建执行器实例
 */
export function createHookExecutor(
  config?: Partial<HookExecutorConfig>
): HookExecutor {
  return new HookExecutor(config);
}
