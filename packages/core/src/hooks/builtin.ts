/**
 * 内置钩子
 *
 * 提供常用的系统级钩子实现
 */

import type { HookDefinition, HookContext, HookResult } from "./types";

/**
 * 危险工具列表
 */
export const DANGEROUS_TOOLS = [
  "write_file",
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
];

/**
 * 危险操作确认钩子
 *
 * 在执行危险工具或命令前请求用户确认
 */
export const confirmDangerousHook: HookDefinition = {
  name: "confirm-dangerous",
  event: "pre_tool",
  priority: 1, // 最高优先级
  enabled: true,
  description: "在执行危险操作前请求用户确认",
  source: "system",
  handler: async (context: HookContext): Promise<HookResult> => {
    const { toolName, args } = context.data as {
      toolName: string;
      args: Record<string, unknown>;
    };

    // 检查是否为危险工具
    if (!DANGEROUS_TOOLS.includes(toolName)) {
      return { proceed: true };
    }

    // 检查命令是否危险
    if (toolName === "execute_command" || toolName === "shell_execute") {
      const command = (args.command as string) ?? "";
      const cmdBase = command.split(" ")[0]?.toLowerCase() ?? "";

      if (DANGEROUS_COMMANDS.some((dc) => cmdBase.includes(dc))) {
        // 这里应该触发用户确认流程
        // 由于这是钩子层，我们返回需要确认的标记
        return {
          proceed: true, // 实际实现中应该等待用户确认
          modifiedData: {
            ...args,
            requiresConfirmation: true,
            confirmationMessage: `即将执行危险操作: ${command}`,
          },
        };
      }
    }

    return { proceed: true };
  },
};

/**
 * 审计日志钩子
 *
 * 记录所有工具调用和命令执行的审计日志
 */
export const auditLogHook: HookDefinition = {
  name: "audit-log",
  event: "post_tool",
  priority: 100,
  enabled: true,
  description: "记录所有工具调用的审计日志",
  source: "system",
  handler: async (context: HookContext): Promise<HookResult> => {
    const { toolName, args, result } = context.data as {
      toolName: string;
      args: Record<string, unknown>;
      result: unknown;
    };

    // 构建审计日志
    const auditEntry = {
      timestamp: context.timestamp.toISOString(),
      sessionId: context.sessionId,
      userId: context.userId,
      platform: context.platform,
      toolName,
      args: sanitizeArgs(args),
      resultType: typeof result,
      success: !isErrorResult(result),
    };

    // 输出审计日志（实际实现中应该写入日志系统）
    console.log("[AUDIT]", JSON.stringify(auditEntry));

    return { proceed: true };
  },
};

/**
 * 速率限制钩子
 *
 * 限制工具调用频率，防止滥用
 */
export const rateLimiterHook: HookDefinition = {
  name: "rate-limiter",
  event: "pre_tool",
  priority: 10,
  enabled: true,
  description: "限制工具调用频率",
  source: "system",
  handler: (() => {
    // 简单的内存速率限制器
    const callCounts = new Map<string, { count: number; resetAt: number }>();
    const LIMIT = 100; // 每分钟最大调用次数
    const WINDOW = 60000; // 时间窗口（毫秒）

    return async (context: HookContext): Promise<HookResult> => {
      const key = context.userId ?? context.sessionId;
      const now = Date.now();

      const record = callCounts.get(key);

      if (!record || now > record.resetAt) {
        // 创建或重置记录
        callCounts.set(key, { count: 1, resetAt: now + WINDOW });
        return { proceed: true };
      }

      if (record.count >= LIMIT) {
        return {
          proceed: false,
          message: `Rate limit exceeded: ${LIMIT} calls per minute`,
        };
      }

      record.count++;
      return { proceed: true };
    };
  })(),
};

/**
 * 文件编辑备份钩子
 *
 * 在文件编辑前创建备份
 */
export const fileBackupHook: HookDefinition = {
  name: "file-backup",
  event: "pre_edit",
  priority: 50,
  enabled: true,
  description: "在文件编辑前创建备份",
  source: "system",
  handler: async (context: HookContext): Promise<HookResult> => {
    const { filePath, content } = context.data as {
      filePath: string;
      content?: string;
    };

    // 实际实现中应该创建备份文件
    // 这里只是标记需要备份
    if (content) {
      return {
        proceed: true,
        modifiedData: {
          filePath,
          createBackup: true,
          backupPath: `${filePath}.backup-${Date.now()}`,
        },
      };
    }

    return { proceed: true };
  },
};

/**
 * 会话统计钩子
 *
 * 记录会话开始和结束的统计信息
 */
export const sessionStatsHook: HookDefinition = {
  name: "session-stats",
  event: "session_end",
  priority: 100,
  enabled: true,
  description: "记录会话统计信息",
  source: "system",
  handler: async (context: HookContext): Promise<HookResult> => {
    const { sessionId, reason, duration } = context.data as {
      sessionId: string;
      reason: string;
      duration: number;
    };

    const stats = {
      sessionId,
      userId: context.userId,
      platform: context.platform,
      reason,
      duration,
      endedAt: context.timestamp.toISOString(),
    };

    // 输出统计信息（实际实现中应该写入统计系统）
    console.log("[SESSION_STATS]", JSON.stringify(stats));

    return { proceed: true };
  },
};

/**
 * 所有内置钩子
 */
export const builtinHooks: HookDefinition[] = [
  confirmDangerousHook,
  auditLogHook,
  rateLimiterHook,
  fileBackupHook,
  sessionStatsHook,
];

/**
 * 注册内置钩子到管理器
 */
export function registerBuiltinHooks(
  register: (hook: HookDefinition) => void
): void {
  for (const hook of builtinHooks) {
    register(hook);
  }
}

// 辅助函数

/**
 * 清理参数中的敏感信息
 */
function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...args };
  const sensitiveKeys = ["password", "token", "secret", "apiKey", "api_key", "credential"];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
      sanitized[key] = sanitizeArgs(sanitized[key] as Record<string, unknown>);
    }
  }

  return sanitized;
}

/**
 * 检查结果是否为错误
 */
function isErrorResult(result: unknown): boolean {
  if (!result) return false;
  if (typeof result !== "object") return false;
  const obj = result as Record<string, unknown>;
  return "error" in obj || "success" in obj && obj.success === false;
}
