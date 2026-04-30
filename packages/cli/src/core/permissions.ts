/**
 * 权限引擎 - ask/allow/deny 三级权限控制
 * 参考 Claude Code 权限系统设计
 */

// Local ToolCall type to avoid @sacode/core dependency issues
export interface ToolCall {
  id?: string;
  function?: {
    name: string;
    arguments: string;
  };
  name?: string;
  arguments?: string | Record<string, unknown>;
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 权限级别
 */
export type PermissionLevel = "allow" | "ask" | "deny";

/**
 * 权限规则
 */
export interface PermissionRule {
  /** 工具名称或正则 */
  tool: string | RegExp;
  /** 权限级别 */
  action: PermissionLevel;
  /** 条件函数（可选） */
  condition?: (args: Record<string, unknown>) => boolean;
  /** 规则描述 */
  description?: string;
}

/**
 * 权限模式
 */
export type PermissionMode =
  | "default" // 默认（询问）
  | "auto" // 自动允许安全操作
  | "bypass" // 跳过所有权限检查
  | "plan" // 计划模式（只读）
  | "strict"; // 严格模式（所有操作都询问）

/**
 * 权限检查结果
 */
export interface PermissionCheckResult {
  /** 是否允许 */
  allowed: boolean;
  /** 权限级别 */
  level: PermissionLevel;
  /** 匹配的规则 */
  matchedRule?: PermissionRule;
  /** 是否需要用户确认 */
  needsConfirmation: boolean;
}

/**
 * 权限引擎配置
 */
export interface PermissionEngineConfig {
  /** 权限模式 */
  mode?: PermissionMode;
  /** 自定义规则 */
  rules?: PermissionRule[];
  /** 用户确认回调 */
  onConfirm?: (toolCall: ToolCall) => Promise<boolean>;
}

// ============================================================================
// 默认规则
// ============================================================================

/**
 * 判断是否是危险的 shell 命令
 */
function isDangerousShell(args: Record<string, unknown>): boolean {
  const cmd = String(args.command ?? args.cmd ?? "");
  const dangerousPatterns = [
    /^rm\s+-rf\s+\/?$/,
    /^mkfs/,
    /^dd\s+of=/,
    /^:\(\)\{\s*:\|:\s*&\s*\};:/, // fork bomb
    /chmod\s+[0-7]*777/,
    /chown\s+root/,
    /\bsudo\b/,
    /\bpowershell\b.*-enc\b/,
    /\bcurl\b.*\|\s*(bash|sh)\b/,
    /\bwget\b.*\|\s*(bash|sh)\b/,
  ];
  return dangerousPatterns.some((pattern) => pattern.test(cmd));
}

/**
 * 默认权限规则
 */
export const DEFAULT_RULES: PermissionRule[] = [
  // 读取操作 - 自动允许
  { tool: "read_file", action: "allow", description: "读取文件" },
  { tool: "list_directory", action: "allow", description: "列出目录" },
  { tool: "glob", action: "allow", description: "文件模式匹配" },
  { tool: "grep_tool", action: "allow", description: "内容搜索" },
  { tool: "web_search", action: "allow", description: "网络搜索" },
  { tool: "web_fetch", action: "allow", description: "网页获取" },
  { tool: "http_request", action: "allow", description: "HTTP 请求" },
  { tool: "lsp_tool", action: "allow", description: "LSP 操作" },
  { tool: "think", action: "allow", description: "内部思考" },
  { tool: "plan", action: "allow", description: "任务规划" },
  { tool: "todo_read", action: "allow", description: "读取待办" },
  { tool: "save_memory", action: "allow", description: "保存记忆" },
  { tool: "image_read", action: "allow", description: "读取图片" },

  // 写入操作 - 需要确认
  { tool: "write_file", action: "ask", description: "写入文件" },
  { tool: "edit_file", action: "ask", description: "编辑文件" },
  { tool: "replace", action: "ask", description: "替换文本" },
  { tool: "delete_file", action: "ask", description: "删除文件" },
  { tool: "todo_write", action: "ask", description: "写入待办" },

  // Shell 命令 - 条件判断
  {
    tool: "run_shell_command",
    action: "ask",
    condition: isDangerousShell,
    description: "执行 Shell 命令",
  },

  // Agent 操作 - 需要确认
  { tool: "task", action: "ask", description: "子代理调用" },
  { tool: "agent_tool", action: "ask", description: "代理工具" },
  { tool: "team_create_tool", action: "ask", description: "创建团队" },
  { tool: "team_delete_tool", action: "ask", description: "删除团队" },

  // 任务管理 - 需要确认
  { tool: "task_create_tool", action: "ask", description: "创建任务" },
  { tool: "task_update_tool", action: "ask", description: "更新任务" },
  { tool: "cron_create_tool", action: "ask", description: "创建定时任务" },

  // Git 操作 - 需要确认
  { tool: "enter_worktree_tool", action: "ask", description: "进入 Worktree" },
  { tool: "exit_worktree_tool", action: "ask", description: "退出 Worktree" },

  // 危险操作 - 拒绝
  { tool: /^dangerous_/, action: "deny", description: "危险操作" },
];

/**
 * 权限检查详细结果
 */
export interface PermissionCheckDetail {
  /** 是否允许 */
  allowed: boolean;
  /** 是否需要用户确认 */
  needsConfirmation: boolean;
  /** 风险等级 */
  riskLevel: "low" | "medium" | "high" | "critical";
  /** 匹配的规则 */
  matchedRule?: PermissionRule;
  /** 确认标题 */
  title: string;
  /** 确认消息 */
  message: string;
  /** 额外详情 */
  details: string[];
}

// ============================================================================
// 权限引擎
// ============================================================================

/**
 * 权限引擎
 *
 * 实现三级权限控制：
 * - allow: 自动允许
 * - ask: 需要用户确认
 * - deny: 自动拒绝
 */
export class PermissionEngine {
  private mode: PermissionMode;
  private rules: PermissionRule[];
  private onConfirm?: ((toolCall: ToolCall) => Promise<boolean>) | undefined;

  constructor(config: PermissionEngineConfig = {}) {
    this.mode = config.mode ?? "default";
    this.rules = config.rules ?? DEFAULT_RULES;
    this.onConfirm = config.onConfirm;
  }

  /**
   * 设置权限模式
   */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /**
   * 获取当前模式
   */
  getMode(): PermissionMode {
    return this.mode;
  }

  /**
   * 添加规则
   */
  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  /**
   * 移除规则
   */
  removeRule(tool: string | RegExp): void {
    this.rules = this.rules.filter((r) => r.tool !== tool);
  }

  /**
   * 检查权限
   */
  async check(toolCall: ToolCall): Promise<boolean> {
    const detail = await this.checkWithDetail(toolCall);
    if (detail.needsConfirmation) {
      return this.askUser(toolCall);
    }
    return detail.allowed;
  }

  /**
   * 检查权限（返回详细信息，不触发 UI 交互）
   */
  async checkWithDetail(toolCall: ToolCall): Promise<PermissionCheckDetail> {
    const toolName = toolCall.function?.name ?? toolCall.name ?? "unknown";
    const args = this.parseArgs(toolCall);

    // 旁路模式 - 全部允许
    if (this.mode === "bypass") {
      return {
        allowed: true,
        needsConfirmation: false,
        riskLevel: "low",
        title: toolName,
        message: "旁路模式，自动允许",
        details: [],
      };
    }

    // 严格模式 - 全部需要确认
    if (this.mode === "strict") {
      return {
        allowed: false,
        needsConfirmation: true,
        riskLevel: "high",
        title: toolName,
        message: `严格模式：需要确认 ${toolName}`,
        details: this.buildDetails(toolName, args),
      };
    }

    // 计划模式 - 只允许读取
    if (this.mode === "plan") {
      const readTools = [
        "read_file",
        "list_directory",
        "glob",
        "grep_tool",
        "web_search",
        "web_fetch",
        "lsp_tool",
        "think",
        "plan",
      ];
      const isRead = readTools.includes(toolName);
      return {
        allowed: isRead,
        needsConfirmation: false,
        riskLevel: isRead ? "low" : "critical",
        title: toolName,
        message: isRead ? "计划模式：读取操作允许" : `计划模式：${toolName} 不允许`,
        details: [],
      };
    }

    // 查找匹配规则
    const rule = this.findRule(toolCall);

    if (!rule) {
      return {
        allowed: false,
        needsConfirmation: true,
        riskLevel: "medium",
        title: toolName,
        message: `未匹配规则：需要确认 ${toolName}`,
        details: this.buildDetails(toolName, args),
      };
    }

    // 检查条件
    if (rule.condition) {
      if (!rule.condition(args)) {
        return {
          allowed: true,
          needsConfirmation: false,
          riskLevel: "low",
          matchedRule: rule,
          title: toolName,
          message: "条件不满足，自动允许",
          details: [],
        };
      }
    }

    switch (rule.action) {
      case "allow":
        return {
          allowed: true,
          needsConfirmation: false,
          riskLevel: "low",
          matchedRule: rule,
          title: toolName,
          message: "规则允许",
          details: [],
        };
      case "deny":
        return {
          allowed: false,
          needsConfirmation: false,
          riskLevel: "critical",
          matchedRule: rule,
          title: toolName,
          message: `规则拒绝：${rule.description ?? toolName}`,
          details: [],
        };
      case "ask":
      default:
        return {
          allowed: false,
          needsConfirmation: true,
          riskLevel: this.assessRiskLevel(toolName, args),
          matchedRule: rule,
          title: toolName,
          message: this.buildConfirmMessage(toolName, args),
          details: this.buildDetails(toolName, args),
        };
    }
  }

  /**
   * 评估风险等级
   */
  private assessRiskLevel(
    toolName: string,
    args: Record<string, unknown>,
  ): "low" | "medium" | "high" | "critical" {
    const criticalTools = ["delete_file", "run_shell_command"];
    const highTools = ["write_file", "edit_file", "replace"];
    if (criticalTools.includes(toolName)) {
      if (toolName === "run_shell_command" && isDangerousShell(args)) {
        return "critical";
      }
      return "high";
    }
    if (highTools.includes(toolName)) {
      return "medium";
    }
    return "low";
  }

  /**
   * 构建确认消息
   */
  private buildConfirmMessage(
    toolName: string,
    args: Record<string, unknown>,
  ): string {
    switch (toolName) {
      case "write_file":
        return `即将写入文件: ${String(args.path ?? "unknown")}`;
      case "edit_file":
      case "replace":
        return `即将编辑文件: ${String(args.path ?? "unknown")}`;
      case "delete_file":
        return `即将删除文件: ${String(args.path ?? "unknown")}`;
      case "run_shell_command":
        return `即将执行命令: ${String(args.command ?? args.cmd ?? "unknown")}`;
      default:
        return `即将执行操作: ${toolName}`;
    }
  }

  /**
   * 构建详情列表
   */
  private buildDetails(
    _toolName: string,
    args: Record<string, unknown>,
  ): string[] {
    const details: string[] = [];
    if (args.path) details.push(`路径: ${String(args.path)}`);
    if (args.command ?? args.cmd) details.push(`命令: ${String(args.command ?? args.cmd)}`);
    if (args.url) details.push(`URL: ${String(args.url)}`);
    return details;
  }
  /**
   * 查找匹配规则
   */
  private findRule(toolCall: ToolCall): PermissionRule | undefined {
    const toolName = toolCall.function?.name ?? toolCall.name ?? "";

    for (const rule of this.rules) {
      if (typeof rule.tool === "string") {
        if (rule.tool === toolName) {
          return rule;
        }
      } else {
        // RegExp
        if (rule.tool.test(toolName)) {
          return rule;
        }
      }
    }

    return undefined;
  }

  /**
   * 解析工具参数
   */
  private parseArgs(toolCall: ToolCall): Record<string, unknown> {
    try {
      const args = toolCall.function?.arguments ?? toolCall.arguments ?? "{}";
      return typeof args === "string" ? JSON.parse(args) : args;
    } catch {
      return {};
    }
  }

  /**
   * 询问用户
   */
  private async askUser(toolCall: ToolCall): Promise<boolean> {
    if (this.onConfirm) {
      return this.onConfirm(toolCall);
    }

    // 默认行为：打印确认提示（实际应由 UI 处理）
    const toolName = toolCall.function?.name ?? toolCall.name ?? "unknown";
    console.log(`\n[!] 需要确认: 允许执行 ${toolName}?`);
    console.log("   (默认允许，实际应由 UI 处理)");
    return true;
  }

  /**
   * 获取所有规则
   */
  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  /**
   * 获取规则摘要
   */
  getRulesSummary(): string {
    const summary: Record<PermissionLevel, number> = {
      allow: 0,
      ask: 0,
      deny: 0,
    };

    for (const rule of this.rules) {
      summary[rule.action]++;
    }

    return `Allow: ${summary.allow}, Ask: ${summary.ask}, Deny: ${summary.deny}`;
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建权限引擎
 */
export function createPermissionEngine(config?: PermissionEngineConfig): PermissionEngine {
  return new PermissionEngine(config);
}

// ============================================================================
// 导出
// ============================================================================

export default PermissionEngine;
