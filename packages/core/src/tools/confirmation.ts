/**
 * 工具确认流程
 *
 * 在执行危险操作前请求用户确认
 */

import EventEmitter from "eventemitter3";

/**
 * 确认模式
 */
export type ConfirmationMode =
  | "always"     // 所有操作都需要确认
  | "dangerous"  // 仅危险操作需要确认
  | "never";     // 从不需要确认

/**
 * 危险工具列表
 */
export const DANGEROUS_TOOLS = [
  "write_file",
  "edit_file",
  "delete_file",
  "execute_command",
  "shell_execute",
  "browser_navigate",
  "run_shell_command",
];

/**
 * 危险命令列表
 */
export const DANGEROUS_COMMANDS = [
  "rm",
  "rmdir",
  "del",
  "format",
  "fdisk",
  "mkfs",
  "dd",
  "shutdown",
  "reboot",
  "init",
  "systemctl",
  "chmod",
  "chown",
];

/**
 * 确认请求
 */
export interface ConfirmationRequest {
  /** 请求 ID */
  id: string;
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  args: Record<string, unknown>;
  /** 确认原因 */
  reason: string;
  /** 风险等级 */
  riskLevel: "low" | "medium" | "high" | "critical";
  /** 创建时间 */
  createdAt: Date;
  /** 过期时间 */
  expiresAt: Date;
  /** 会话 ID */
  sessionId: string;
  /** 用户 ID */
  userId?: string;
}

/**
 * 确认响应
 */
export interface ConfirmationResponse {
  /** 请求 ID */
  requestId: string;
  /** 是否确认 */
  confirmed: boolean;
  /** 响应时间 */
  respondedAt: Date;
  /** 用户 ID */
  userId?: string;
  /** 备注 */
  note?: string;
}

/**
 * 确认管理器配置
 */
export interface ConfirmationConfig {
  /** 是否启用确认 */
  enabled: boolean;
  /** 确认模式 */
  mode: ConfirmationMode;
  /** 超时时间（毫秒） */
  timeout: number;
  /** 自定义危险工具列表 */
  dangerousTools?: string[];
  /** 自定义危险命令列表 */
  dangerousCommands?: string[];
  /** 是否自动拒绝超时 */
  autoRejectOnTimeout: boolean;
  /** 最大等待队列长度 */
  maxPendingRequests: number;
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIRMATION_CONFIG: ConfirmationConfig = {
  enabled: true,
  mode: "dangerous",
  timeout: 60000, // 1 分钟
  autoRejectOnTimeout: true,
  maxPendingRequests: 100,
};

/**
 * 确认事件
 */
export interface ConfirmationEvents {
  /** 确认请求 */
  request: [request: ConfirmationRequest];
  /** 确认响应 */
  response: [response: ConfirmationResponse];
  /** 超时 */
  timeout: [requestId: string];
  /** 错误 */
  error: [error: Error];
}

/**
 * 工具确认管理器
 *
 * @example
 * ```typescript
 * const manager = new ToolConfirmationManager({
 *   mode: "dangerous",
 *   timeout: 30000,
 * });
 *
 * // 检查是否需要确认
 * const needsConfirm = manager.needsConfirmation("write_file", { path: "/important.txt" });
 *
 * if (needsConfirm) {
 *   const confirmed = await manager.requestConfirmation({
 *     toolName: "write_file",
 *     args: { path: "/important.txt" },
 *     sessionId: "session-1",
 *   });
 *
 *   if (!confirmed) {
 *     throw new Error("User denied the operation");
 *   }
 * }
 * ```
 */
export class ToolConfirmationManager extends EventEmitter<ConfirmationEvents> {
  private config: ConfirmationConfig;
  private pendingRequests: Map<string, {
    request: ConfirmationRequest;
    resolve: (confirmed: boolean) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private dangerousTools: Set<string>;
  private dangerousCommands: Set<string>;

  constructor(config: Partial<ConfirmationConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIRMATION_CONFIG, ...config };
    this.dangerousTools = new Set([
      ...DANGEROUS_TOOLS,
      ...(this.config.dangerousTools ?? []),
    ]);
    this.dangerousCommands = new Set([
      ...DANGEROUS_COMMANDS,
      ...(this.config.dangerousCommands ?? []),
    ]);
  }

  /**
   * 检查是否需要确认
   */
  needsConfirmation(toolName: string, args: Record<string, unknown>): boolean {
    if (!this.config.enabled) return false;
    if (this.config.mode === "never") return false;
    if (this.config.mode === "always") return true;

    // dangerous 模式：检查是否为危险工具
    if (this.dangerousTools.has(toolName)) {
      // 对于命令执行，进一步检查命令是否危险
      if (toolName === "execute_command" || toolName === "shell_execute" || toolName === "run_shell_command") {
        const command = this.extractCommand(args);
        if (command && this.isDangerousCommand(command)) {
          return true;
        }
      } else {
        return true;
      }
    }

    return false;
  }

  /**
   * 请求确认
   */
  async requestConfirmation(options: {
    toolName: string;
    args: Record<string, unknown>;
    sessionId: string;
    userId?: string;
  }): Promise<boolean> {
    if (!this.needsConfirmation(options.toolName, options.args)) {
      return true;
    }

    // 检查队列长度
    if (this.pendingRequests.size >= this.config.maxPendingRequests) {
      throw new Error("Too many pending confirmation requests");
    }

    const requestId = this.generateRequestId();
    const riskLevel = this.assessRiskLevel(options.toolName, options.args);
    const reason = this.generateReason(options.toolName, options.args, riskLevel);

    const request: ConfirmationRequest = {
      id: requestId,
      toolName: options.toolName,
      args: options.args,
      reason,
      riskLevel,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.timeout),
      sessionId: options.sessionId,
      userId: options.userId,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.emit("timeout", requestId);

        if (this.config.autoRejectOnTimeout) {
          resolve(false);
        } else {
          reject(new Error("Confirmation request timed out"));
        }
      }, this.config.timeout);

      this.pendingRequests.set(requestId, {
        request,
        resolve,
        reject,
        timeout,
      });

      this.emit("request", request);
    });
  }

  /**
   * 响应确认请求
   */
  respond(requestId: string, confirmed: boolean, note?: string): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    const response: ConfirmationResponse = {
      requestId,
      confirmed,
      respondedAt: new Date(),
      userId: pending.request.userId,
      note,
    };

    this.emit("response", response);
    pending.resolve(confirmed);

    return true;
  }

  /**
   * 取消确认请求
   */
  cancel(requestId: string): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    pending.reject(new Error("Confirmation request cancelled"));

    return true;
  }

  /**
   * 获取待处理的请求
   */
  getPendingRequests(): ConfirmationRequest[] {
    return Array.from(this.pendingRequests.values()).map((p) => p.request);
  }

  /**
   * 获取待处理请求数量
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * 清除所有待处理请求
   */
  clearAll(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("All confirmation requests cleared"));
    }
    this.pendingRequests.clear();
  }

  /**
   * 添加危险工具
   */
  addDangerousTool(toolName: string): void {
    this.dangerousTools.add(toolName);
  }

  /**
   * 移除危险工具
   */
  removeDangerousTool(toolName: string): void {
    this.dangerousTools.delete(toolName);
  }

  /**
   * 添加危险命令
   */
  addDangerousCommand(command: string): void {
    this.dangerousCommands.add(command);
  }

  /**
   * 移除危险命令
   */
  removeDangerousCommand(command: string): void {
    this.dangerousCommands.delete(command);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ConfirmationConfig>): void {
    this.config = { ...this.config, ...config };

    // 更新危险工具/命令列表
    if (config.dangerousTools) {
      this.dangerousTools = new Set([
        ...DANGEROUS_TOOLS,
        ...config.dangerousTools,
      ]);
    }
    if (config.dangerousCommands) {
      this.dangerousCommands = new Set([
        ...DANGEROUS_COMMANDS,
        ...config.dangerousCommands,
      ]);
    }
  }

  /**
   * 获取配置
   */
  getConfig(): ConfirmationConfig {
    return { ...this.config };
  }

  // 私有方法

  /**
   * 生成请求 ID
   */
  private generateRequestId(): string {
    return `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 从参数中提取命令
   */
  private extractCommand(args: Record<string, unknown>): string | null {
    const command = args.command ?? args.cmd;
    if (typeof command === "string") {
      return command;
    }
    return null;
  }

  /**
   * 检查命令是否危险
   */
  private isDangerousCommand(command: string): boolean {
    const baseCommand = command.split(" ")[0]?.toLowerCase() ?? "";
    return this.dangerousCommands.has(baseCommand);
  }

  /**
   * 评估风险等级
   */
  private assessRiskLevel(
    toolName: string,
    args: Record<string, unknown>
  ): ConfirmationRequest["riskLevel"] {
    // 文件操作
    if (toolName === "delete_file") {
      return "critical";
    }

    if (toolName === "write_file") {
      const path = args.path as string;
      if (typeof path === "string") {
        if (path.includes("/etc/") || path.includes("C:\\Windows\\")) {
          return "critical";
        }
        if (path.includes("/home/") || path.includes("C:\\Users\\")) {
          return "high";
        }
      }
      return "medium";
    }

    // 命令执行
    if (toolName === "execute_command" || toolName === "shell_execute" || toolName === "run_shell_command") {
      const command = this.extractCommand(args);
      if (command && this.isDangerousCommand(command)) {
        return "critical";
      }
      return "high";
    }

    // 浏览器操作
    if (toolName === "browser_navigate") {
      return "medium";
    }

    return "low";
  }

  /**
   * 生成确认原因
   */
  private generateReason(
    toolName: string,
    args: Record<string, unknown>,
    riskLevel: ConfirmationRequest["riskLevel"]
  ): string {
    const riskEmoji = {
      low: "⚠️",
      medium: "⚠️⚠️",
      high: "🚨",
      critical: "🔴🚨",
    };

    const emoji = riskEmoji[riskLevel];

    switch (toolName) {
      case "write_file":
        return `${emoji} 即将写入文件: ${args.path ?? "unknown"}`;
      case "delete_file":
        return `${emoji} 即将删除文件: ${args.path ?? "unknown"}`;
      case "execute_command":
      case "shell_execute":
      case "run_shell_command":
        return `${emoji} 即将执行命令: ${args.command ?? args.cmd ?? "unknown"}`;
      case "browser_navigate":
        return `${emoji} 即将导航到: ${args.url ?? "unknown"}`;
      default:
        return `${emoji} 即将执行操作: ${toolName}`;
    }
  }
}

/**
 * 创建工具确认管理器实例
 */
export function createToolConfirmationManager(
  config?: Partial<ConfirmationConfig>
): ToolConfirmationManager {
  return new ToolConfirmationManager(config);
}
