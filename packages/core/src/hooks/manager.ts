/**
 * 钩子管理器
 *
 * 负责钩子的注册、发现、执行和生命周期管理
 */

import * as fs from "fs";
import * as path from "path";
import type {
  HookEvent,
  HookDefinition,
  HookContext,
  HookResult,
  HookManagerConfig,
  HookFileMetadata,
} from "./types";
import { DEFAULT_HOOK_MANAGER_CONFIG } from "./types";
import { HookExecutor } from "./executor";

/**
 * 钩子管理器
 *
 * @example
 * ```typescript
 * const manager = new HookManager({ hooksDir: "hooks" });
 * await manager.initialize();
 *
 * // 注册钩子
 * manager.register({
 *   name: "log-edit",
 *   event: "post_edit",
 *   priority: 100,
 *   enabled: true,
 *   handler: async (ctx) => {
 *     console.log(`File edited: ${ctx.data.filePath}`);
 *     return { proceed: true };
 *   },
 * });
 *
 * // 触发事件
 * await manager.execute("post_edit", {
 *   sessionId: "session-1",
 *   data: { filePath: "/path/to/file.ts", content: "new content" },
 * });
 * ```
 */
export class HookManager {
  private config: HookManagerConfig;
  private hooks: Map<string, HookDefinition> = new Map();
  private hooksByEvent: Map<HookEvent, HookDefinition[]> = new Map();
  private executor: HookExecutor;
  private initialized: boolean = false;

  constructor(config: Partial<HookManagerConfig> = {}) {
    this.config = { ...DEFAULT_HOOK_MANAGER_CONFIG, ...config };
    this.executor = new HookExecutor({
      defaultTimeout: this.config.defaultTimeout,
      enableLogging: this.config.enableLogging,
    });

    // 初始化事件映射
    const events: HookEvent[] = [
      "pre_edit",
      "post_edit",
      "pre_command",
      "post_command",
      "pre_tool",
      "post_tool",
      "session_start",
      "session_end",
    ];
    for (const event of events) {
      this.hooksByEvent.set(event, []);
    }
  }

  /**
   * 初始化管理器
   *
   * 自动发现并加载钩子
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.autoDiscover) {
      await this.discover();
    }

    this.initialized = true;
  }

  /**
   * 注册钩子
   */
  register(
    hook: HookDefinition,
    options?: { overwrite?: boolean }
  ): boolean {
    const existing = this.hooks.get(hook.name);

    if (existing && !options?.overwrite) {
      return false;
    }

    // 添加到全局映射
    this.hooks.set(hook.name, hook);

    // 添加到事件映射
    const eventHooks = this.hooksByEvent.get(hook.event) ?? [];
    if (existing) {
      // 移除旧的
      const index = eventHooks.findIndex((h) => h.name === hook.name);
      if (index !== -1) {
        eventHooks.splice(index, 1);
      }
    }
    eventHooks.push(hook);

    // 按优先级排序
    eventHooks.sort((a, b) => a.priority - b.priority);
    this.hooksByEvent.set(hook.event, eventHooks);

    return true;
  }

  /**
   * 注销钩子
   */
  unregister(name: string): boolean {
    const hook = this.hooks.get(name);
    if (!hook) return false;

    // 从全局映射移除
    this.hooks.delete(name);

    // 从事件映射移除
    const eventHooks = this.hooksByEvent.get(hook.event);
    if (eventHooks) {
      const index = eventHooks.findIndex((h) => h.name === name);
      if (index !== -1) {
        eventHooks.splice(index, 1);
      }
    }

    return true;
  }

  /**
   * 获取钩子
   */
  get(name: string): HookDefinition | undefined {
    return this.hooks.get(name);
  }

  /**
   * 获取事件的所有钩子
   */
  getHooksForEvent(event: HookEvent): HookDefinition[] {
    return this.hooksByEvent.get(event) ?? [];
  }

  /**
   * 获取所有钩子
   */
  getAll(): HookDefinition[] {
    return Array.from(this.hooks.values());
  }

  /**
   * 启用钩子
   */
  enable(name: string): boolean {
    const hook = this.hooks.get(name);
    if (!hook) return false;

    hook.enabled = true;
    return true;
  }

  /**
   * 禁用钩子
   */
  disable(name: string): boolean {
    const hook = this.hooks.get(name);
    if (!hook) return false;

    hook.enabled = false;
    return true;
  }

  /**
   * 执行事件的所有钩子
   *
   * 按优先级顺序执行，支持中断
   */
  async execute<E extends HookEvent>(
    event: E,
    context: Omit<HookContext, "event" | "timestamp">
  ): Promise<{
    results: HookResult[];
    proceed: boolean;
    modifiedData?: Record<string, unknown>;
  }> {
    const hooks = this.getHooksForEvent(event);
    const results: HookResult[] = [];
    let proceed = true;
    let modifiedData = context.data;

    for (const hook of hooks) {
      if (!hook.enabled) continue;

      const fullContext: HookContext = {
        ...context,
        event,
        timestamp: new Date(),
        data: modifiedData,
      };

      const result = await this.executor.execute(hook, fullContext);
      results.push(result);

      // 如果钩子返回 proceed: false，中断执行
      if (!result.proceed) {
        proceed = false;
        break;
      }

      // 如果钩子修改了数据，更新上下文
      if (result.modifiedData) {
        modifiedData = { ...modifiedData, ...result.modifiedData };
      }
    }

    return {
      results,
      proceed,
      modifiedData: modifiedData !== context.data ? modifiedData : undefined,
    };
  }

  /**
   * 发现并加载钩子
   *
   * 从文件系统扫描钩子目录
   */
  async discover(): Promise<HookFileMetadata[]> {
    const hooksDir = this.resolveHooksDir();
    const discovered: HookFileMetadata[] = [];

    if (!fs.existsSync(hooksDir)) {
      return discovered;
    }

    const events = this.getEventDirectories();

    for (const event of events) {
      const eventDir = path.join(hooksDir, event);

      if (!fs.existsSync(eventDir)) continue;

      const entries = await fs.promises.readdir(eventDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!this.isHookFile(entry.name)) continue;

        const filePath = path.join(eventDir, entry.name);
        const stat = await fs.promises.stat(filePath);

        const metadata: HookFileMetadata = {
          path: filePath,
          event: event as HookEvent,
          enabled: true,
          modifiedAt: stat.mtime,
        };

        discovered.push(metadata);

        // 加载钩子
        await this.loadHookFile(filePath, event as HookEvent);
      }
    }

    return discovered;
  }

  /**
   * 加载钩子文件
   */
  private async loadHookFile(
    filePath: string,
    event: HookEvent
  ): Promise<void> {
    try {
      // 支持 .ts, .js, .mjs 文件
      const ext = path.extname(filePath);

      if (ext === ".ts" || ext === ".js" || ext === ".mjs") {
        // 动态导入模块
        const module = await import(filePath);
        const hookExport = module.default ?? module.hook ?? module;

        // 如果导出的是钩子定义
        if (this.isValidHookDefinition(hookExport)) {
          this.register({
            ...hookExport,
            event,
            source: "user",
          });
        }
        // 如果导出的是钩子数组
        else if (Array.isArray(hookExport)) {
          for (const hook of hookExport) {
            if (this.isValidHookDefinition(hook)) {
              this.register({
                ...hook,
                event,
                source: "user",
              });
            }
          }
        }
        // 如果导出的是处理函数
        else if (typeof hookExport === "function") {
          const name = path.basename(filePath, ext);
          this.register({
            name,
            event,
            priority: 100,
            enabled: true,
            handler: hookExport,
            source: "user",
          });
        }
      }
    } catch (error) {
      console.error(`Failed to load hook file ${filePath}:`, error);
    }
  }

  /**
   * 验证是否为有效的钩子定义
   */
  private isValidHookDefinition(value: unknown): value is HookDefinition {
    if (!value || typeof value !== "object") return false;
    const obj = value as Record<string, unknown>;
    return (
      typeof obj["name"] === "string" &&
      typeof obj["handler"] === "function"
    );
  }

  /**
   * 检查是否为钩子文件
   */
  private isHookFile(filename: string): boolean {
    return /\.(ts|js|mjs)$/.test(filename);
  }

  /**
   * 获取事件目录列表
   */
  private getEventDirectories(): string[] {
    return [
      "pre-edit",
      "post-edit",
      "pre-command",
      "post-command",
      "pre-tool",
      "post-tool",
      "session",
    ];
  }

  /**
   * 解析钩子目录路径
   */
  private resolveHooksDir(): string {
    if (path.isAbsolute(this.config.hooksDir)) {
      return this.config.hooksDir;
    }
    return path.resolve(process.cwd(), this.config.hooksDir);
  }

  /**
   * 获取执行统计
   */
  getStats(hookName?: string) {
    return this.executor.getStats(hookName);
  }

  /**
   * 获取执行日志
   */
  getLogs(options?: Parameters<HookExecutor["getLogs"]>[0]) {
    return this.executor.getLogs(options);
  }

  /**
   * 清除日志
   */
  clearLogs(): void {
    this.executor.clearLogs();
  }

  /**
   * 重新加载所有钩子
   */
  async reload(): Promise<void> {
    // 清除现有钩子
    this.hooks.clear();
    for (const event of this.hooksByEvent.keys()) {
      this.hooksByEvent.set(event, []);
    }

    // 重新发现
    await this.discover();
  }
}

/**
 * 创建钩子管理器实例
 */
export function createHookManager(
  config?: Partial<HookManagerConfig>
): HookManager {
  return new HookManager(config);
}
