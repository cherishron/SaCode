/**
 * 上下文收集系统
 * 参考 Claude Code context.ts 设计
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 系统上下文
 */
export interface SystemContext {
  /** 当前工作目录 */
  cwd: string;
  /** Git 状态 */
  gitStatus?: string | undefined;
  /** 操作系统信息 */
  osInfo: string;
  /** Node.js 版本 */
  nodeVersion: string;
  /** 时间戳 */
  timestamp: string;
  /** 缓存破坏器 */
  cacheBreaker: string;
}

/**
 * 用户上下文
 */
export interface UserContext {
  /** CLAUDE.md / SACODE.md 内容 */
  sacodeMd?: string | undefined;
  /** 当前日期 */
  currentDate: string;
  /** 用户名 */
  username?: string | undefined;
  /** 环境变量摘要 */
  envSummary?: string | undefined;
}

/**
 * 上下文配置
 */
export interface ContextConfig {
  /** 工作目录 */
  cwd?: string;
  /** 是否收集 Git 状态 */
  includeGit?: boolean;
  /** 是否收集环境信息 */
  includeEnv?: boolean;
}

// ============================================================================
// 上下文收集器
// ============================================================================

/**
 * 上下文收集器
 *
 * 收集系统和用户上下文信息，用于注入到系统提示中
 */
export class ContextCollector {
  private cwd: string;
  private includeGit: boolean;
  private includeEnv: boolean;
  private cacheBreaker: string;

  constructor(config: ContextConfig = {}) {
    this.cwd = config.cwd ?? process.cwd();
    this.includeGit = config.includeGit ?? true;
    this.includeEnv = config.includeEnv ?? false;
    this.cacheBreaker = Date.now().toString(36);
  }

  /**
   * 获取系统上下文
   */
  async getSystemContext(): Promise<SystemContext> {
    const context: SystemContext = {
      cwd: this.cwd,
      osInfo: `${process.platform} ${process.arch}`,
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
      cacheBreaker: this.cacheBreaker,
    };

    // 收集 Git 状态
    if (this.includeGit) {
      context.gitStatus = await this.getGitStatus();
    }

    return context;
  }

  /**
   * 获取用户上下文
   */
  async getUserContext(): Promise<UserContext> {
    const context: UserContext = {
      currentDate: new Date().toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      }),
    };

    // 读取 SACODE.md / CLAUDE.md
    context.sacodeMd = await this.readProjectContext();

    // 用户名
    context.username = process.env.USER || process.env.USERNAME || undefined;

    // 环境变量摘要
    if (this.includeEnv) {
      const sensitiveKeys = ["KEY", "SECRET", "TOKEN", "PASSWORD"];
      const envVars = Object.entries(process.env)
        .filter(([key]) => !sensitiveKeys.some((s) => key.toUpperCase().includes(s)))
        .map(([key, value]) => `${key}=${value?.slice(0, 50)}...`)
        .slice(0, 20)
        .join("\n");
      context.envSummary = envVars;
    }

    return context;
  }

  /**
   * 获取 Git 状态
   */
  private async getGitStatus(): Promise<string | undefined> {
    try {
      const gitDir = path.join(this.cwd, ".git");
      if (!fs.existsSync(gitDir)) return undefined;

      const statusProc = Bun.spawnSync({
        cmd: ["git", "status", "--short"],
        cwd: this.cwd,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 5000,
      });
      const status = statusProc.stdout?.toString() ?? "";

      const branchProc = Bun.spawnSync({
        cmd: ["git", "branch", "--show-current"],
        cwd: this.cwd,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 5000,
      });
      const branch = (branchProc.stdout?.toString() ?? "").trim();

      return `Branch: ${branch}\n${status.trim() || "Working tree clean"}`;
    } catch {
      return undefined;
    }
  }

  /**
   * 读取项目上下文文件
   */
  private async readProjectContext(): Promise<string | undefined> {
    const contextFiles = ["SACODE.md", "CLAUDE.md", "AGENTS.md", "README.md"];

    for (const file of contextFiles) {
      const filePath = path.join(this.cwd, file);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          // 限制大小（最多 10KB）
          return content.slice(0, 10240);
        } catch {
          continue;
        }
      }
    }

    return undefined;
  }

  /**
   * 格式化为系统提示
   */
  async formatAsSystemPrompt(): Promise<string> {
    const [system, user] = await Promise.all([this.getSystemContext(), this.getUserContext()]);

    const parts: string[] = [];

    // 系统信息
    parts.push("## System Context");
    parts.push(`- Working Directory: ${system.cwd}`);
    parts.push(`- OS: ${system.osInfo}`);
    parts.push(`- Node.js: ${system.nodeVersion}`);
    parts.push(`- Time: ${system.timestamp}`);
    if (system.gitStatus) {
      parts.push(`- Git Status:\n${system.gitStatus}`);
    }

    // 用户信息
    parts.push("\n## User Context");
    parts.push(`- Current Date: ${user.currentDate}`);
    if (user.username) {
      parts.push(`- Username: ${user.username}`);
    }
    if (user.sacodeMd) {
      parts.push(`\n## Project Context (SACODE.md)\n${user.sacodeMd}`);
    }

    return parts.join("\n");
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建上下文收集器
 */
export function createContextCollector(config?: ContextConfig): ContextCollector {
  return new ContextCollector(config);
}

// ============================================================================
// 导出
// ============================================================================

export default ContextCollector;
