/**
 * SaClaw Container Module - Agent 容器
 *
 * 专门用于运行 AI Agent 的容器实例
 */

import { z } from "zod";
import type { Logger } from "./index";
import { Container } from "./index";
import {
  type SandboxConfig,
  type SandboxLevel,
  mergeSandboxConfig,
} from "./sandbox";

// ============================================================================
// Agent Configuration
// ============================================================================

/**
 * Agent 配置
 */
export const AgentConfigSchema = z.object({
  /** Agent ID */
  agentId: z.string(),
  /** Agent 名称 */
  name: z.string().optional(),
  /** 镜像 */
  image: z.string().default("saclaw/agent:latest"),
  /** 工作目录 */
  workdir: z.string().default("/workspace"),
  /** 环境变量 */
  env: z.record(z.string()).optional(),
  /** 沙箱级别 */
  sandboxLevel: z.enum(["strict", "moderate", "permissive", "custom"]).default("moderate"),
  /** 自定义沙箱配置 */
  sandboxConfig: z.custom<SandboxConfig>().optional(),
  /** 最大执行时间 */
  maxExecutionTime: z.number().default(300000),
  /** 最大迭代次数 */
  maxIterations: z.number().default(100),
  /** 允许的工具列表 */
  allowedTools: z.array(z.string()).optional(),
  /** 禁止的工具列表 */
  deniedTools: z.array(z.string()).optional(),
  /** 输出目录 */
  outputDir: z.string().optional(),
  /** 输入文件目录 */
  inputDir: z.string().optional(),
  /** 日志级别 */
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * Agent 执行结果
 */
export const AgentExecutionResultSchema = z.object({
  /** 执行 ID */
  executionId: z.string(),
  /** Agent ID */
  agentId: z.string(),
  /** 退出代码 */
  exitCode: z.number(),
  /** 输出内容 */
  output: z.string(),
  /** 错误输出 */
  error: z.string().optional(),
  /** 执行时长 (毫秒) */
  duration: z.number(),
  /** 迭代次数 */
  iterations: z.number(),
  /** 是否成功 */
  success: z.boolean(),
  /** 输出文件 */
  outputFiles: z.array(z.string()).optional(),
  /** 指标 */
  metrics: z
    .object({
      tokensUsed: z.number().optional(),
      apiCalls: z.number().optional(),
      filesRead: z.number().optional(),
      filesWritten: z.number().optional(),
      commandsExecuted: z.number().optional(),
    })
    .optional(),
});
export type AgentExecutionResult = z.infer<typeof AgentExecutionResultSchema>;

/**
 * Agent 状态
 */
export type AgentStatus =
  | "created"
  | "initializing"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "timeout"
  | "stopped";

/**
 * Agent 资源使用统计
 */
export const AgentResourceUsageSchema = z.object({
  /** CPU 使用率 (百分比) */
  cpuPercent: z.number(),
  /** 内存使用 (字节) */
  memoryUsage: z.number(),
  /** 内存限制 (字节) */
  memoryLimit: z.number(),
  /** 内存使用率 (百分比) */
  memoryPercent: z.number(),
  /** 网络接收字节 */
  networkRx: z.number(),
  /** 网络发送字节 */
  networkTx: z.number(),
  /** 块设备读字节 */
  blockRead: z.number(),
  /** 块设备写字节 */
  blockWrite: z.number(),
  /** 进程数 */
  pids: z.number(),
  /** 时间戳 */
  timestamp: z.string(),
});
export type AgentResourceUsage = z.infer<typeof AgentResourceUsageSchema>;

// ============================================================================
// AgentContainer Class
// ============================================================================

/**
 * Agent 容器实例
 */
export class AgentContainer {
  readonly agentId: string;
  readonly config: AgentConfig;
  readonly sandboxConfig: SandboxConfig;

  private container: Container | null = null;
  private status: AgentStatus = "created";
  private logger: Logger;
  private startTime: number | null = null;
  private currentIteration = 0;
  private abortController: AbortController | null = null;

  constructor(config: AgentConfig, logger?: Logger) {
    this.agentId = config.agentId;
    this.config = AgentConfigSchema.parse(config);
    this.logger = logger ?? console;

    // 合并沙箱配置
    this.sandboxConfig = mergeSandboxConfig(
      this.config.sandboxLevel,
      this.config.sandboxConfig
    );
  }

  /**
   * 获取当前状态
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * 初始化容器
   */
  async initialize(): Promise<void> {
    this.status = "initializing";
    this.logger.info(`Initializing agent container: ${this.agentId}`);

    try {
      // 创建容器配置 (TODO: 实际创建容器)
      // const dockerArgs = sandboxToDockerArgs(this.sandboxConfig);
      // this.container = await this.createContainer(dockerArgs, env);

      // 添加环境变量
      const env: Record<string, string> = {
        AGENT_ID: this.agentId,
        WORKDIR: this.config.workdir,
        MAX_ITERATIONS: this.config.maxIterations.toString(),
        LOG_LEVEL: this.config.logLevel,
        ...this.config.env,
      };

      if (this.config.allowedTools) {
        env.ALLOWED_TOOLS = this.config.allowedTools.join(",");
      }
      if (this.config.deniedTools) {
        env.DENIED_TOOLS = this.config.deniedTools.join(",");
      }

      this.status = "ready";
      this.logger.info(`Agent container initialized: ${this.agentId}`);
    } catch (error) {
      this.status = "failed";
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initialize agent container: ${message}`);
      throw error;
    }
  }

  /**
   * 执行任务
   */
  async execute(task: string, options?: { timeout?: number }): Promise<AgentExecutionResult> {
    if (this.status !== "ready") {
      throw new Error(`Agent not ready, current status: ${this.status}`);
    }

    this.status = "running";
    this.startTime = Date.now();
    this.currentIteration = 0;
    this.abortController = new AbortController();

    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timeout = options?.timeout ?? this.config.maxExecutionTime;

    this.logger.info(`Starting execution: ${executionId}`, { task });

    try {
      // 设置超时
      const timeoutId = setTimeout(() => {
        this.abortController?.abort();
      }, timeout);

      // 执行任务
      const result = await this.runTask(task, executionId);

      clearTimeout(timeoutId);

      this.status = result.success ? "completed" : "failed";
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        this.status = "timeout";
        return {
          executionId,
          agentId: this.agentId,
          exitCode: -1,
          output: "",
          error: "Execution timeout",
          duration: Date.now() - (this.startTime ?? Date.now()),
          iterations: this.currentIteration,
          success: false,
        };
      }

      this.status = "failed";
      throw error;
    }
  }

  /**
   * 暂停执行
   */
  async pause(): Promise<void> {
    if (this.status !== "running") {
      throw new Error(`Cannot pause, current status: ${this.status}`);
    }

    this.logger.info(`Pausing agent: ${this.agentId}`);
    this.status = "paused";

    if (this.container) {
      // TODO: 暂停容器
      // await this.container.pause();
    }
  }

  /**
   * 恢复执行
   */
  async resume(): Promise<void> {
    if (this.status !== "paused") {
      throw new Error(`Cannot resume, current status: ${this.status}`);
    }

    this.logger.info(`Resuming agent: ${this.agentId}`);
    this.status = "running";

    if (this.container) {
      // TODO: 恢复容器
      // await this.container.unpause();
    }
  }

  /**
   * 停止执行
   */
  async stop(): Promise<void> {
    this.logger.info(`Stopping agent: ${this.agentId}`);

    this.abortController?.abort();
    this.status = "stopped";

    if (this.container) {
      try {
        // await this.container.stop();
      } catch (error) {
        this.logger.warn(`Error stopping container: ${error}`);
      }
    }
  }

  /**
   * 获取资源使用情况
   */
  async getResourceUsage(): Promise<AgentResourceUsage | null> {
    if (!this.container) {
      return null;
    }

    // TODO: 实现实际的资源监控
    return {
      cpuPercent: 0,
      memoryUsage: 0,
      memoryLimit: 512 * 1024 * 1024,
      memoryPercent: 0,
      networkRx: 0,
      networkTx: 0,
      blockRead: 0,
      blockWrite: 0,
      pids: 1,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 获取日志
   */
  async getLogs(_options?: { tail?: number; since?: Date }): Promise<string[]> {
    if (!this.container) {
      return [];
    }

    // TODO: 获取实际日志
    // const logs = await this.container.logs(options);
    return [];
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    this.logger.info(`Cleaning up agent: ${this.agentId}`);

    if (this.container) {
      try {
        // await this.container.remove(true);
      } catch (error) {
        this.logger.warn(`Error removing container: ${error}`);
      }
    }

    this.container = null;
    this.status = "stopped";
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private async runTask(task: string, executionId: string): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    // 模拟执行
    // 实际实现中，这里会与容器内的 Agent 进程通信

    this.logger.debug(`Running task: ${task.substring(0, 100)}...`);

    // TODO: 实际执行逻辑
    // 1. 将任务发送到容器
    // 2. 接收流式输出
    // 3. 处理迭代
    // 4. 收集结果

    return {
      executionId,
      agentId: this.agentId,
      exitCode: 0,
      output: "Task completed successfully",
      duration: Date.now() - startTime,
      iterations: this.currentIteration,
      success: true,
      metrics: {
        tokensUsed: 0,
        apiCalls: 0,
        filesRead: 0,
        filesWritten: 0,
        commandsExecuted: 0,
      },
    };
  }
}

// ============================================================================
// AgentContainerManager
// ============================================================================

/**
 * Agent 容器管理器配置
 */
export interface AgentContainerManagerOptions {
  /** 默认镜像 */
  defaultImage?: string;
  /** 默认沙箱级别 */
  defaultSandboxLevel?: SandboxLevel;
  /** 日志器 */
  logger?: Logger;
}

/**
 * Agent 容器管理器
 */
export class AgentContainerManager {
  private agents: Map<string, AgentContainer> = new Map();
  private defaultImage: string;
  private defaultSandboxLevel: SandboxLevel;
  private logger: Logger;

  constructor(options: AgentContainerManagerOptions = {}) {
    this.defaultImage = options.defaultImage ?? "saclaw/agent:latest";
    this.defaultSandboxLevel = options.defaultSandboxLevel ?? "moderate";
    this.logger = options.logger ?? console;
  }

  /**
   * 创建 Agent 容器
   */
  async createAgent(config: Partial<AgentConfig> & { agentId: string }): Promise<AgentContainer> {
    const fullConfig: AgentConfig = {
      agentId: config.agentId,
      name: config.name ?? `agent-${config.agentId}`,
      image: config.image ?? this.defaultImage,
      workdir: config.workdir ?? "/workspace",
      sandboxLevel: config.sandboxLevel ?? this.defaultSandboxLevel,
      maxExecutionTime: config.maxExecutionTime ?? 300000,
      maxIterations: config.maxIterations ?? 100,
      logLevel: config.logLevel ?? "info",
      env: config.env ?? {},
    };

    const agent = new AgentContainer(fullConfig, this.logger);
    await agent.initialize();

    this.agents.set(config.agentId, agent);
    return agent;
  }

  /**
   * 获取 Agent
   */
  getAgent(agentId: string): AgentContainer | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 列出所有 Agent
   */
  listAgents(): AgentContainer[] {
    return Array.from(this.agents.values());
  }

  /**
   * 停止并移除 Agent
   */
  async removeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    await agent.stop();
    await agent.cleanup();
    this.agents.delete(agentId);
  }

  /**
   * 清理所有 Agent
   */
  async cleanup(): Promise<void> {
    for (const [id, agent] of this.agents) {
      try {
        await agent.stop();
        await agent.cleanup();
      } catch (error) {
        this.logger.warn(`Failed to cleanup agent ${id}:`, error);
      }
    }
    this.agents.clear();
  }

  /**
   * 获取所有 Agent 状态统计
   */
  getStats(): {
    total: number;
    byStatus: Record<AgentStatus, number>;
  } {
    const byStatus: Record<AgentStatus, number> = {
      created: 0,
      initializing: 0,
      ready: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      timeout: 0,
      stopped: 0,
    };

    for (const agent of this.agents.values()) {
      byStatus[agent.getStatus()]++;
    }

    return {
      total: this.agents.size,
      byStatus,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * 创建 Agent 容器管理器
 */
export function createAgentContainerManager(
  options?: AgentContainerManagerOptions
): AgentContainerManager {
  return new AgentContainerManager(options);
}

/**
 * 创建单个 Agent 容器
 */
export async function createAgentContainer(
  config: Partial<AgentConfig> & { agentId: string },
  options?: AgentContainerManagerOptions
): Promise<AgentContainer> {
  const manager = new AgentContainerManager(options);
  return manager.createAgent(config);
}
