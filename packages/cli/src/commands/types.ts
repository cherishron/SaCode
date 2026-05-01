/**
 * 命令类型定义
 *
 * 支持 Commander.js 命令和 Slash 命令两种类型
 */

import type { Command } from "commander";

// ============================================================================
// Commander.js 命令类型
// ============================================================================

/**
 * 命令上下文
 */
export interface CommandContext {
  program: Command;
}

/**
 * 命令注册函数
 */
export type CommandRegister = (ctx: CommandContext) => void;

// ============================================================================
// Slash 命令类型
// ============================================================================

/**
 * Slash 命令参数类型
 */
export type SlashCommandArgType = "string" | "number" | "boolean" | "file" | "path";

/**
 * Slash 命令参数定义
 */
export interface SlashCommandArg {
  /** 参数名称 */
  name: string;
  /** 参数描述 */
  description?: string;
  /** 参数类型 */
  type?: SlashCommandArgType;
  /** 是否必需 */
  required?: boolean;
  /** 默认值 */
  default?: string | number | boolean;
  /** 可选值列表 */
  choices?: string[];
}

/**
 * Slash 命令标志定义
 */
export interface SlashCommandFlag {
  /** 标志名称（短格式，如 -v） */
  short?: string;
  /** 标志名称（长格式，如 --verbose） */
  long: string;
  /** 标志描述 */
  description?: string;
  /** 标志类型 */
  type?: "boolean" | "string" | "number";
  /** 默认值 */
  default?: string | number | boolean;
}

/**
 * Slash 命令执行上下文
 */
export interface SlashCommandContext {
  /** 命令参数 */
  args: Record<string, string | number | boolean>;
  /** 命令标志 */
  flags: Record<string, string | number | boolean>;
  /** 原始输入 */
  rawInput: string;
  /** 会话 ID */
  sessionId?: string;
  /** 输出函数 */
  output: (message: string) => void;
  /** 错误输出函数 */
  error: (message: string) => void;
}

/**
 * Slash 命令执行结果
 */
export interface SlashCommandResult {
  /** 是否成功 */
  success: boolean;
  /** 输出消息 */
  message?: string;
  /** 错误消息 */
  error?: string;
  /** 是否继续对话 */
  continue?: boolean;
}

/**
 * Slash 命令定义
 */
export interface SlashCommand {
  /** 命令名称（不含 / 前缀） */
  name: string;
  /** 命令别名 */
  aliases?: string[];
  /** 命令描述 */
  description: string;
  /** 命令分类 */
  category?: "general" | "session" | "model" | "tool" | "config" | "debug";
  /** 参数定义 */
  args?: SlashCommandArg[];
  /** 标志定义 */
  flags?: SlashCommandFlag[];
  /** 使用示例 */
  examples?: string[];
  /** 是否在帮助中隐藏 */
  hidden?: boolean;
  /** 执行函数 */
  execute: (ctx: SlashCommandContext) => Promise<SlashCommandResult> | SlashCommandResult;
}

/**
 * Slash 命令注册表
 */
export interface SlashCommandRegistry {
  /** 注册命令 */
  register(command: SlashCommand): void;
  /** 注销命令 */
  unregister(name: string): void;
  /** 获取命令 */
  get(name: string): SlashCommand | undefined;
  /** 获取所有命令 */
  getAll(): SlashCommand[];
  /** 搜索命令 */
  search(query: string): SlashCommand[];
}

/**
 * 解析后的 Slash 命令
 */
export interface ParsedSlashCommand {
  /** 命令名称 */
  name: string;
  /** 参数列表 */
  args: string[];
  /** 标志 */
  flags: Record<string, string | number | boolean>;
  /** 原始输入 */
  raw: string;
  /** 是否有效 */
  valid: boolean;
  /** 错误信息 */
  error?: string;
}

// ============================================================================
// 内置命令类型
// ============================================================================

/**
 * 内置 Slash 命令定义
 */
export const BUILTIN_SLASH_COMMANDS: Omit<SlashCommand, "execute">[] = [
  {
    name: "help",
    aliases: ["h", "?"],
    description: "显示帮助信息",
    category: "general",
  },
  {
    name: "clear",
    aliases: ["cls"],
    description: "清除对话历史",
    category: "session",
  },
  {
    name: "exit",
    aliases: ["quit", "q"],
    description: "退出程序",
    category: "general",
  },
  {
    name: "models",
    aliases: ["m"],
    description: "管理模型（交互式选择）",
    category: "model",
    args: [
      {
        name: "name",
        description: "模型名称",
        type: "string",
        required: false,
      },
    ],
    flags: [
      {
        long: "--list",
        short: "-l",
        description: "列出所有可用模型",
        type: "boolean",
      },
    ],
  },
  {
    name: "theme",
    description: "切换主题",
    category: "config",
    args: [
      {
        name: "name",
        description: "主题名称",
        type: "string",
        required: false,
      },
    ],
    flags: [
      {
        long: "--list",
        short: "-l",
        description: "列出所有可用主题",
        type: "boolean",
      },
    ],
  },
  {
    name: "lang",
    description: "切换语言",
    category: "config",
    args: [
      {
        name: "code",
        description: "语言代码 (zh-CN, en-US)",
        type: "string",
        required: false,
      },
    ],
  },
  {
    name: "prefs",
    description: "查看或修改偏好设置",
    category: "config",
    flags: [
      {
        long: "--set",
        description: "设置偏好值",
        type: "string",
      },
      {
        long: "--get",
        description: "获取偏好值",
        type: "string",
      },
    ],
  },
  {
    name: "history",
    aliases: ["hist"],
    description: "查看对话历史",
    category: "session",
    flags: [
      {
        long: "--clear",
        short: "-c",
        description: "清除历史",
        type: "boolean",
      },
    ],
  },
  {
    name: "compact",
    description: "压缩上下文",
    category: "session",
    flags: [
      {
        long: "--force",
        short: "-f",
        description: "强制压缩",
        type: "boolean",
      },
    ],
  },
  {
    name: "recall",
    description: "检索记忆",
    category: "session",
    args: [
      {
        name: "query",
        description: "搜索关键词",
        type: "string",
        required: false,
      },
    ],
  },
  {
    name: "remember",
    description: "保存到记忆",
    category: "session",
    args: [
      {
        name: "content",
        description: "记忆内容",
        type: "string",
        required: true,
      },
    ],
  },
  {
    name: "cost",
    description: "查看 Token 使用量和成本",
    category: "debug",
  },
  {
    name: "debug",
    description: "切换调试模式",
    category: "debug",
    flags: [
      {
        long: "--on",
        description: "开启调试",
        type: "boolean",
      },
      {
        long: "--off",
        description: "关闭调试",
        type: "boolean",
      },
    ],
  },
  {
    name: "init",
    description: "解读当前项目并生成 AGENTS.md",
    category: "config",
    flags: [
      {
        long: "--force",
        short: "-f",
        description: "覆盖已有的 AGENTS.md",
        type: "boolean",
      },
    ],
  },
  {
    name: "session",
    aliases: ["s"],
    description: "管理会话",
    category: "session",
    args: [
      {
        name: "action",
        description: "操作: list / info / clear / resume",
        type: "string",
        required: false,
        choices: ["list", "info", "clear", "resume"],
      },
    ],
  },
  {
    name: "auth",
    description: "管理认证账户（CodingPlan + 环境变量）",
    category: "config",
    args: [
      {
        name: "action",
        description: "操作: list / add / env",
        type: "string",
        required: false,
        choices: ["list", "add", "env"],
      },
    ],
    flags: [
      {
        long: "--provider",
        short: "-p",
        description: "厂商 (aliyun/volcengine/baidu/tencent/zhipu/minimax/ucloud/kimi/jdcloud/mimo/longcat/volcark/custom)",
        type: "string",
      },
      {
        long: "--key",
        short: "-k",
        description: "API Key",
        type: "string",
      },
      {
        long: "--url",
        short: "-u",
        description: "自定义 API 端点 (custom 厂商必填)",
        type: "string",
      },
      {
        long: "--alias",
        short: "-a",
        description: "账户别名",
        type: "string",
      },
    ],
  },
];