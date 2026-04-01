import { z } from "zod";

/**
 * 队列任务状态
 */
export const QueueTaskStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type QueueTaskStatusType = (typeof QueueTaskStatus)[keyof typeof QueueTaskStatus];

/**
 * 队列任务
 */
export interface QueueTask<T = unknown, R = unknown> {
  id: string;
  groupId: string;
  data: T;
  status: QueueTaskStatusType;
  result: R | undefined;
  error: string | undefined;
  createdAt: Date;
  startedAt: Date | undefined;
  completedAt: Date | undefined;
  retryCount: number;
}

/**
 * 群组队列配置
 */
export const GroupQueueConfigSchema = z.object({
  /** 每个群组的最大并发数 */
  concurrency: z.number().min(1).default(1),
  /** 任务超时时间（毫秒） */
  timeout: z.number().min(1000).default(60000),
  /** 最大重试次数 */
  maxRetries: z.number().min(0).default(3),
  /** 任务执行器 */
  executor: z.function().optional(),
});

export type GroupQueueConfig<T = unknown, R = unknown> = z.infer<typeof GroupQueueConfigSchema> & {
  executor?: (task: QueueTask<T>) => Promise<R>;
};

/**
 * 队列统计信息
 */
export interface QueueStats {
  groupId: string;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}

/**
 * 队列事件
 */
export interface QueueEvent<T = unknown, R = unknown> {
  type: "enqueued" | "started" | "completed" | "failed" | "retry";
  task: QueueTask<T, R>;
  timestamp: Date;
}
