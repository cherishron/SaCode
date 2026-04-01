/**
 * SACODE Container Module - 类型定义
 */

import { z } from "zod";

// ============================================================================
// 容器运行时类型
// ============================================================================

/**
 * 容器运行时类型
 */
export const ContainerRuntimeSchema = z.enum(["docker", "podman"]);
export type ContainerRuntime = z.infer<typeof ContainerRuntimeSchema>;

/**
 * 容器状态
 */
export const ContainerStateSchema = z.enum([
  "created",
  "running",
  "paused",
  "restarting",
  "removing",
  "exited",
  "dead",
]);
export type ContainerState = z.infer<typeof ContainerStateSchema>;

// ============================================================================
// 容器配置
// ============================================================================

/**
 * 容器配置
 */
export const ContainerConfigSchema = z.object({
  /** 容器名称 */
  name: z.string().optional(),
  /** 镜像 */
  image: z.string().default("node:22-alpine"),
  /** 工作目录 */
  workingDir: z.string().default("/app"),
  /** 环境变量 */
  env: z.record(z.string()).optional(),
  /** 端口映射 */
  ports: z.array(z.string()).optional(),
  /** 卷挂载 */
  volumes: z.array(z.string()).optional(),
  /** 内存限制 */
  memory: z.string().optional(),
  /** CPU限制 */
  cpu: z.number().optional(),
  /** 网络模式 */
  network: z.string().optional(),
  /** 自动清理 */
  autoRemove: z.boolean().default(true),
  /** 超时时间(毫秒) */
  timeout: z.number().default(300000),
});
export type ContainerConfig = z.infer<typeof ContainerConfigSchema>;

/**
 * 容器信息
 */
export const ContainerInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: ContainerStateSchema,
  created: z.string(),
  status: z.string(),
  ports: z.array(z.string()).optional(),
  mounts: z.array(z.string()).optional(),
});
export type ContainerInfo = z.infer<typeof ContainerInfoSchema>;

/**
 * 容器执行结果
 */
export const ContainerExecResultSchema = z.object({
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  signal: z.string().optional(),
  duration: z.number(),
});
export type ContainerExecResult = z.infer<typeof ContainerExecResultSchema>;

/**
 * 容器日志
 */
export const ContainerLogSchema = z.object({
  timestamp: z.string(),
  stream: z.enum(["stdout", "stderr"]),
  message: z.string(),
});
export type ContainerLog = z.infer<typeof ContainerLogSchema>;

// ============================================================================
// Logger 接口
// ============================================================================

/**
 * 日志器接口
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

// ============================================================================
// 管理器配置
// ============================================================================

/**
 * 容器管理器配置
 */
export interface ContainerManagerOptions {
  /** Docker/Podman运行时 */
  runtime?: "docker" | "podman";
  /** 默认容器配置 */
  defaultConfig?: Partial<ContainerConfig>;
  /** 日志器 */
  logger?: Logger;
}

/**
 * 创建容器管理器选项
 */
export interface CreateContainerManagerOptions {
  runtime?: "docker" | "podman";
  defaultImage?: string;
  logger?: Logger;
}
