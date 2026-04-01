import { z } from "zod";

/**
 * 支持的平台类型 (避免循环依赖，内联定义)
 */
export type Platform =
  | "wechat"
  | "qq"
  | "telegram"
  | "discord"
  | "dingtalk"
  | "feishu";

/**
 * IM 消息接口 (最小定义，避免循环依赖)
 */
export interface IMMessage {
  id: string;
  platform: Platform;
  channelId: string;
  userId: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * IM 适配器接口 (最小定义，避免循环依赖)
 */
export interface IMAdapter {
  platform: Platform;
  isConnected(): boolean;
  send(message: IMMessage): Promise<void>;
}

/**
 * 任务类型
 */
export type TaskType = "interval" | "once" | "cron";

/**
 * Cron 表达式验证 (5位: minute hour day month weekday)
 */
const cronRegex = /^(\*|([0-9]|[1-5][0-9])) (\*|([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|[12][0-9]|3[01])) (\*|([1-9]|1[0-2])) (\*|([0-6]))$/;

/**
 * 任务配置 Schema
 */
export const TaskConfigSchema = z.object({
  // 间隔任务配置 (秒)
  interval: z.number().positive().optional(),
  // 一次性任务执行时间
  executeAt: z.date().optional(),
  // Cron 表达式
  cronExpression: z.string().regex(cronRegex, "Invalid cron expression").optional(),
}).refine(
  (data) => data.interval !== undefined || data.executeAt !== undefined || data.cronExpression !== undefined,
  { message: "At least one of interval, executeAt, or cronExpression must be provided" }
);

export type TaskConfig = z.infer<typeof TaskConfigSchema>;

/**
 * 定时任务 Schema
 */
export const CronTaskSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["interval", "once", "cron"]),
  config: TaskConfigSchema,
  message: z.string().min(1),
  channel: z.enum(["wechat", "qq", "telegram", "discord", "dingtalk", "feishu"]),
  chatId: z.string().min(1),
  enabled: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastRunAt: z.date().nullable().optional(),
  nextRunAt: z.date().nullable().optional(),
  runCount: z.number().default(0),
  maxRetries: z.number().default(3),
  retryCount: z.number().default(0),
  metadata: z.record(z.unknown()).optional(),
});

export type CronTask = z.infer<typeof CronTaskSchema>;

/**
 * 创建任务输入 (不包含自动生成的字段，可选字段有默认值)
 */
export type CreateTaskInput = Omit<CronTask, "id" | "createdAt" | "updatedAt" | "lastRunAt" | "nextRunAt" | "runCount" | "retryCount" | "enabled" | "maxRetries"> & {
  /** 是否启用 (默认 true) */
  enabled?: boolean;
  /** 最大重试次数 (默认 3) */
  maxRetries?: number;
};

/**
 * 任务执行结果
 */
export interface TaskExecutionResult {
  taskId: string;
  success: boolean;
  executedAt: Date;
  error?: string;
  response?: string;
  retryNeeded?: boolean;
}

/**
 * 任务执行器接口
 */
export interface TaskExecutor {
  execute(task: CronTask): Promise<TaskExecutionResult>;
}

/**
 * 任务调度器配置
 */
export interface TaskSchedulerConfig {
  /** 是否自动启动 */
  autoStart: boolean;
  /** 检查间隔（毫秒） */
  checkInterval: number;
  /** 最大并发任务数 */
  maxConcurrency: number;
  /** 任务存储路径 */
  storagePath: string;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试延迟（毫秒） */
  retryDelay: number;
  /** 是否持久化存储 */
  persistTasks: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_SCHEDULER_CONFIG: TaskSchedulerConfig = {
  autoStart: true,
  checkInterval: 1000, // 1 秒 (更精确的检查)
  maxConcurrency: 10,
  storagePath: ".SACODE/tasks.json",
  maxRetries: 3,
  retryDelay: 5000, // 5 秒
  persistTasks: true,
};

/**
 * 任务事件
 */
export interface TaskEvent {
  type: "scheduled" | "started" | "completed" | "failed" | "cancelled" | "updated" | "retrying";
  task: CronTask;
  timestamp: Date;
  error?: string | undefined;
  result?: TaskExecutionResult | undefined;
}

/**
 * 任务事件回调
 */
export type TaskEventCallback = (event: TaskEvent) => void;

/**
 * 任务执行日志
 */
export interface TaskExecutionLog {
  taskId: string;
  executedAt: Date;
  success: boolean;
  error?: string | undefined;
  response?: string | undefined;
  duration: number; // 毫秒
}

/**
 * 任务统计
 */
export interface TaskStats {
  total: number;
  enabled: number;
  disabled: number;
  byType: {
    interval: number;
    once: number;
    cron: number;
  };
  totalRuns: number;
  successRate: number;
}