/**
 * 会话安全边界
 * 
 * 实现 main/dm/group 三种会话类型的权限隔离
 */

import { z } from "zod";

// ============================================
// 会话类型定义
// ============================================

/**
 * 会话类型：
 * - main: 主会话，完全权限
 * - dm: 私信会话，受限权限
 * - group: 群组会话，最小权限
 */
export const SessionSecurityTypeSchema = z.enum(["main", "dm", "group"]);

export type SessionSecurityType = z.infer<typeof SessionSecurityTypeSchema>;

/**
 * 会话类型标识符格式：
 * - main: "main"
 * - dm: "dm:{platform}:{userId}"
 * - group: "group:{platform}:{groupId}"
 */
export type SessionTypeIdentifier =
  | "main"
  | `dm:${string}:${string}`
  | `group:${string}:${string}`;

/**
 * 解析会话类型标识符
 */
export function parseSessionTypeIdentifier(id: string): {
  type: SessionSecurityType;
  platform?: string | undefined;
  entityId?: string | undefined;
} {
  if (id === "main") {
    return { type: "main" };
  }

  const dmMatch = id.match(/^dm:([^:]+):(.+)$/);
  if (dmMatch) {
    return { type: "dm", platform: dmMatch[1], entityId: dmMatch[2] };
  }

  const groupMatch = id.match(/^group:([^:]+):(.+)$/);
  if (groupMatch) {
    return { type: "group", platform: groupMatch[1], entityId: groupMatch[2] };
  }

  throw new Error(`Invalid session type identifier: ${id}`);
}

/**
 * 创建会话类型标识符
 */
export function createSessionTypeIdentifier(
  type: "main",
): "main";
export function createSessionTypeIdentifier(
  type: "dm" | "group",
  platform: string,
  entityId: string,
): `dm:${string}:${string}` | `group:${string}:${string}`;
export function createSessionTypeIdentifier(
  type: SessionSecurityType,
  platform?: string,
  entityId?: string,
): SessionTypeIdentifier {
  if (type === "main") {
    return "main";
  }
  if (!platform || !entityId) {
    throw new Error(`Platform and entityId required for ${type} session type`);
  }
  return `${type}:${platform}:${entityId}`;
}

// ============================================
// 权限定义
// ============================================

/**
 * 沙箱模式
 */
export const SandboxModeSchema = z.enum(["none", "docker", "strict"]);

export type SandboxMode = z.infer<typeof SandboxModeSchema>;

/**
 * 会话权限配置
 */
export const SessionPermissionsSchema = z.object({
  /** 允许的工具列表，"*" 表示全部 */
  allowTools: z.array(z.string()),
  /** 沙箱模式 */
  sandboxMode: SandboxModeSchema,
  /** 允许访问的文件路径 */
  allowedPaths: z.array(z.string()),
  /** 禁止访问的文件路径 */
  deniedPaths: z.array(z.string()),
  /** 最大执行时间（毫秒） */
  maxExecutionTime: z.number(),
  /** 最大输出长度 */
  maxOutputLength: z.number(),
  /** 允许的网络请求 */
  allowNetwork: z.boolean(),
  /** 允许的网络域名白名单 */
  allowedDomains: z.array(z.string()),
  /** 允许执行的环境变量 */
  allowedEnvVars: z.array(z.string()),
  /** 是否允许创建子进程 */
  allowSubprocess: z.boolean(),
  /** 是否允许访问系统剪贴板 */
  allowClipboard: z.boolean(),
});

export type SessionPermissions = z.infer<typeof SessionPermissionsSchema>;

/**
 * 默认权限配置
 */
export const DEFAULT_PERMISSIONS: Record<SessionSecurityType, SessionPermissions> = {
  main: {
    allowTools: ["*"],
    sandboxMode: "none",
    allowedPaths: ["*"],
    deniedPaths: [],
    maxExecutionTime: 300000, // 5 minutes
    maxOutputLength: 100000,
    allowNetwork: true,
    allowedDomains: ["*"],
    allowedEnvVars: ["*"],
    allowSubprocess: true,
    allowClipboard: true,
  },
  dm: {
    allowTools: [
      "read_file",
      "search_files",
      "list_directory",
      "web_search",
      "web_fetch",
    ],
    sandboxMode: "docker",
    allowedPaths: [],
    deniedPaths: ["*"],
    maxExecutionTime: 60000, // 1 minute
    maxOutputLength: 10000,
    allowNetwork: true,
    allowedDomains: [],
    allowedEnvVars: [],
    allowSubprocess: false,
    allowClipboard: false,
  },
  group: {
    allowTools: ["read_file", "search_files"],
    sandboxMode: "strict",
    allowedPaths: [],
    deniedPaths: ["*"],
    maxExecutionTime: 30000, // 30 seconds
    maxOutputLength: 5000,
    allowNetwork: false,
    allowedDomains: [],
    allowedEnvVars: [],
    allowSubprocess: false,
    allowClipboard: false,
  },
};

// ============================================
// 权限管理器
// ============================================

export interface SecurityManagerConfig {
  /** 自定义权限配置 */
  customPermissions?: Partial<Record<SessionSecurityType, Partial<SessionPermissions>>>;
  /** 工具黑名单 */
  toolBlacklist?: string[];
  /** 命令黑名单 */
  commandBlacklist?: string[];
}

export class SecurityManager {
  private permissions: Record<SessionSecurityType, SessionPermissions>;
  private toolBlacklist: Set<string>;
  private commandBlacklist: Set<string>;

  constructor(config: SecurityManagerConfig = {}) {
    // 合并默认权限和自定义权限
    this.permissions = { ...DEFAULT_PERMISSIONS };
    if (config.customPermissions) {
      for (const [type, custom] of Object.entries(config.customPermissions)) {
        if (custom && type in this.permissions) {
          this.permissions[type as SessionSecurityType] = {
            ...this.permissions[type as SessionSecurityType],
            ...custom,
          };
        }
      }
    }

    this.toolBlacklist = new Set(config.toolBlacklist ?? []);
    this.commandBlacklist = new Set(config.commandBlacklist ?? DEFAULT_COMMAND_BLACKLIST);
  }

  /**
   * 获取会话类型的权限配置
   */
  getPermissions(sessionType: SessionSecurityType): SessionPermissions {
    return this.permissions[sessionType];
  }

  /**
   * 检查工具是否允许执行
   */
  isToolAllowed(sessionType: SessionSecurityType, toolName: string): boolean {
    // 检查黑名单
    if (this.toolBlacklist.has(toolName)) {
      return false;
    }

    const permissions = this.permissions[sessionType];

    // 检查白名单
    if (permissions.allowTools.includes("*")) {
      return true;
    }

    return permissions.allowTools.includes(toolName);
  }

  /**
   * 检查路径是否允许访问
   */
  isPathAllowed(sessionType: SessionSecurityType, path: string): boolean {
    const permissions = this.permissions[sessionType];

    // 检查拒绝列表
    if (permissions.deniedPaths.includes("*")) {
      return false;
    }

    for (const denied of permissions.deniedPaths) {
      if (path.startsWith(denied)) {
        return false;
      }
    }

    // 检查允许列表
    if (permissions.allowedPaths.includes("*")) {
      return true;
    }

    for (const allowed of permissions.allowedPaths) {
      if (path.startsWith(allowed)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查命令是否允许执行
   */
  isCommandAllowed(sessionType: SessionSecurityType, command: string): boolean {
    // 主会话检查黑名单
    if (sessionType === "main") {
      for (const blacklisted of this.commandBlacklist) {
        if (command.includes(blacklisted)) {
          return false;
        }
      }
      return true;
    }

    // 非 main 会话不允许执行命令
    return false;
  }

  /**
   * 检查网络请求是否允许
   */
  isNetworkAllowed(sessionType: SessionSecurityType, domain?: string): boolean {
    const permissions = this.permissions[sessionType];

    if (!permissions.allowNetwork) {
      return false;
    }

    if (!domain) {
      return true;
    }

    if (permissions.allowedDomains.includes("*")) {
      return true;
    }

    return permissions.allowedDomains.includes(domain);
  }

  /**
   * 获取沙箱模式
   */
  getSandboxMode(sessionType: SessionSecurityType): SandboxMode {
    return this.permissions[sessionType].sandboxMode;
  }

  /**
   * 获取最大执行时间
   */
  getMaxExecutionTime(sessionType: SessionSecurityType): number {
    return this.permissions[sessionType].maxExecutionTime;
  }

  /**
   * 更新权限配置
   */
  updatePermissions(
    sessionType: SessionSecurityType,
    updates: Partial<SessionPermissions>
  ): void {
    this.permissions[sessionType] = {
      ...this.permissions[sessionType],
      ...updates,
    };
  }
}

/**
 * 默认命令黑名单
 */
const DEFAULT_COMMAND_BLACKLIST = [
  "rm -rf /",
  "rm -rf ~",
  "sudo rm",
  "mkfs",
  "dd if=",
  ":(){ :|:& };:",
  "chmod 777",
  "chown root",
  "> /dev/sda",
  "mv /*",
  "shutdown",
  "reboot",
  "init 0",
  "init 6",
];

// ============================================
// 工厂函数
// ============================================

export function createSecurityManager(config?: SecurityManagerConfig): SecurityManager {
  return new SecurityManager(config);
}
