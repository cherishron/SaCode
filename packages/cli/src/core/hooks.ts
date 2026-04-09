/**
 * Hook 引擎 - 生命周期钩子系统
 * 参考 Claude Code Hook 系统设计
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Hook 事件类型
 */
export type HookEvent =
  | "beforeTool"
  | "afterTool"
  | "beforeQuery"
  | "afterQuery"
  | "beforeCompaction"
  | "afterCompaction"
  | "sessionStart"
  | "sessionEnd"
  | "error"
  | "userMessage"
  | "assistantMessage"
  | "toolDenied";

/**
 * Hook 处理器函数类型
 */
export type HookHandler = (...args: unknown[]) => Promise<void> | void;

/**
 * Hook 注册项
 */
interface HookRegistration {
  event: HookEvent;
  handler: HookHandler;
  priority: number;
  id: string;
}

// ============================================================================
// Hook 引擎
// ============================================================================

/**
 * Hook 引擎
 *
 * 实现发布订阅模式的生命周期钩子系统：
 * - 支持多个事件类型
 * - 支持优先级排序
 * - 支持异步执行
 * - 支持错误隔离
 */
export class HookEngine {
  private registrations: HookRegistration[] = [];
  private hookIdCounter = 0;

  /**
   * 注册钩子
   */
  on(event: HookEvent, handler: HookHandler, priority = 0): string {
    const id = `hook-${++this.hookIdCounter}`;
    this.registrations.push({ event, handler, priority, id });
    // 按优先级排序（高优先级先执行）
    this.registrations.sort((a, b) => b.priority - a.priority);
    return id;
  }

  /**
   * 注册一次性钩子
   */
  once(event: HookEvent, handler: HookHandler, priority = 0): string {
    const id = `hook-once-${++this.hookIdCounter}`;
    const wrappedHandler: HookHandler = async (...args) => {
      await handler(...args);
      this.off(id);
    };
    this.registrations.push({ event, handler: wrappedHandler, priority, id });
    return id;
  }

  /**
   * 移除钩子
   */
  off(id: string): void {
    this.registrations = this.registrations.filter((r) => r.id !== id);
  }

  /**
   * 移除指定事件的所有钩子
   */
  offEvent(event: HookEvent): void {
    this.registrations = this.registrations.filter((r) => r.event !== event);
  }

  /**
   * 移除所有钩子
   */
  clear(): void {
    this.registrations = [];
  }

  /**
   * 执行钩子
   */
  async run(event: HookEvent, ...args: unknown[]): Promise<void> {
    const hooks = this.registrations.filter((r) => r.event === event);

    for (const hook of hooks) {
      try {
        await hook.handler(...args);
      } catch (error) {
        // 错误隔离：单个钩子失败不影响其他钩子
        console.error(`[Hook Error] ${hook.id} (${event}):`, error);
      }
    }
  }

  /**
   * 获取已注册的钩子
   */
  getHooks(event?: HookEvent): HookRegistration[] {
    if (event) {
      return this.registrations.filter((r) => r.event === event);
    }
    return [...this.registrations];
  }

  /**
   * 获取所有事件类型
   */
  getEvents(): HookEvent[] {
    return [...new Set(this.registrations.map((r) => r.event))];
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Hook 引擎
 */
export function createHookEngine(): HookEngine {
  return new HookEngine();
}

// ============================================================================
// 导出
// ============================================================================

export default HookEngine;
