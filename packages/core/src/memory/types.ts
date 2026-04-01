import { z } from "zod";

/**
 * 会话记忆配置
 */
export const MemoryConfigSchema = z.object({
  /** 会话存储目录 */
  sessionsDir: z.string().default("sessions"),
  /** 记忆文件名 */
  memoryFileName: z.string().default("CLAUDE.md"),
  /** 最大记忆大小（字符） */
  maxMemorySize: z.number().default(100000),
  /** 是否自动压缩 */
  autoCompact: z.boolean().default(true),
  /** 压缩阈值（字符） */
  compactThreshold: z.number().default(50000),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

/**
 * 会话记忆数据
 */
export interface SessionMemory {
  /** 会话 ID */
  sessionId: string;
  /** 记忆内容 */
  content: string;
  /** 创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/**
 * 记忆更新事件
 */
export interface MemoryUpdateEvent {
  sessionId: string;
  action: "create" | "update" | "compact" | "delete";
  timestamp: Date;
  previousSize: number;
  currentSize: number;
}
