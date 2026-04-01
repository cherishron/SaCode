/**
 * Hooks 系统类型定义
 *
 * 支持事件驱动的钩子机制，用于在关键操作前后执行自定义逻辑
 */

/**
 * 支持的钩子事件类型
 */
export type HookEvent =
  | "pre_edit"      // 文件编辑前
  | "post_edit"     // 文件编辑后
  | "pre_command"   // 命令执行前
  | "post_command"  // 命令执行后
  | "pre_tool"      // 工具调用前
  | "post_tool"     // 工具调用后
  | "session_start" // 会话开始
  | "session_end";  // 会话结束

/**
 * 钩子上下文
 */
export interface HookContext {
  /** 事件类型 */
  event: HookEvent;
  /** 时间戳 */
  timestamp: Date;
  /** 会话 ID */
  sessionId: string;
  /** 用户 ID */
  userId?: string;
  /** 平台标识 */
  platform?: string;
  /** 事件相关数据 */
  data: Record<string, unknown>;
}

/**
 * 钩子执行结果
 */
export interface HookResult {
  /** 是否继续执行后续操作 */
  proceed: boolean;
  /** 修改后的数据（可选） */
  modifiedData?: Record<string, unknown>;
  /** 提示消息（可选） */
  message?: string;
  /** 错误信息（可选） */
  error?: Error;
}

/**
 * 钩子定义
 */
export interface HookDefinition {
  /** 钩子名称 */
  name: string;
  /** 监听的事件 */
  event: HookEvent;
  /** 执行优先级（数字越小越先执行） */
  priority: number;
  /** 是否启用 */
  enabled: boolean;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 是否异步执行 */
  async?: boolean;
  /** 钩子处理函数 */
  handler: (context: HookContext) => Promise<HookResult> | HookResult;
  /** 钩子描述 */
  description?: string;
  /** 钩子来源 */
  source?: "system" | "user" | "plugin";
}

/**
 * 钩子注册选项
 */
export interface HookRegisterOptions {
  /** 是否覆盖已存在的同名钩子 */
  overwrite?: boolean;
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * 钩子执行统计
 */
export interface HookStats {
  /** 总执行次数 */
  totalExecutions: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failureCount: number;
  /** 平均执行时间（毫秒） */
  avgExecutionTime: number;
  /** 最后执行时间 */
  lastExecutedAt?: Date;
}

/**
 * 钩子执行日志
 */
export interface HookExecutionLog {
  /** 钩子名称 */
  hookName: string;
  /** 事件类型 */
  event: HookEvent;
  /** 执行时间 */
  executedAt: Date;
  /** 是否成功 */
  success: boolean;
  /** 执行耗时（毫秒） */
  duration: number;
  /** 结果 */
  result?: HookResult;
  /** 错误信息 */
  error?: string;
}

/**
 * 钩子管理器配置
 */
export interface HookManagerConfig {
  /** 用户钩子目录 */
  hooksDir: string;
  /** 是否自动发现钩子 */
  autoDiscover: boolean;
  /** 默认超时时间（毫秒） */
  defaultTimeout: number;
  /** 最大并发执行数 */
  maxConcurrency: number;
  /** 是否记录执行日志 */
  enableLogging: boolean;
  /** 日志保留数量 */
  maxLogEntries: number;
}

/**
 * 默认配置
 */
export const DEFAULT_HOOK_MANAGER_CONFIG: HookManagerConfig = {
  hooksDir: "hooks",
  autoDiscover: true,
  defaultTimeout: 30000,
  maxConcurrency: 5,
  enableLogging: true,
  maxLogEntries: 1000,
};

/**
 * 钩子事件数据映射
 */
export interface HookEventDataMap {
  pre_edit: {
    filePath: string;
    content?: string;
    newContent?: string;
  };
  post_edit: {
    filePath: string;
    content: string;
    previousContent?: string;
  };
  pre_command: {
    command: string;
    args?: string[];
  };
  post_command: {
    command: string;
    args?: string[];
    exitCode: number;
    stdout?: string;
    stderr?: string;
  };
  pre_tool: {
    toolName: string;
    args: Record<string, unknown>;
  };
  post_tool: {
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
  };
  session_start: {
    sessionId: string;
    userId?: string;
    platform?: string;
  };
  session_end: {
    sessionId: string;
    reason: "completed" | "cancelled" | "error" | "timeout";
    duration: number;
  };
}

/**
 * 类型安全的事件数据获取
 */
export type EventData<E extends HookEvent> = HookEventDataMap[E];

/**
 * 钩子文件元数据
 */
export interface HookFileMetadata {
  /** 文件路径 */
  path: string;
  /** 事件类型 */
  event: HookEvent;
  /** 是否启用 */
  enabled: boolean;
  /** 最后修改时间 */
  modifiedAt: Date;
}
