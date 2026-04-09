/**
 * 项目上下文管理 — 自动收集项目信息
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import type { ProjectContext, ConversationMessage } from "./types.js";

const MAX_TREE_DEPTH = 3;
const MAX_FILE_SIZE = 50_000; // 50KB
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", ".next", ".cache", "coverage"]);

export class ContextManager {
  private rootDir: string;
  private messages: ConversationMessage[] = [];
  // @ts-expect-error reserved for future token budget management
  private _maxContextTokens: number;

  constructor(rootDir: string, maxContextTokens: number = 128_000) {
    this.rootDir = resolve(rootDir);
    this._maxContextTokens = maxContextTokens;
  }

  /**
   * 收集项目上下文
   */
  async gatherProjectContext(): Promise<ProjectContext> {
    const context: ProjectContext = {
      rootDir: this.rootDir,
      directoryTree: this.buildDirectoryTree(this.rootDir, 0),
      relevantFiles: [],
    };

    // 读取 package.json
    const pkgPath = join(this.rootDir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        context.packageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
      } catch { /* ignore parse errors */ }
    }

    // 读取 tsconfig.json
    const tsPath = join(this.rootDir, "tsconfig.json");
    if (existsSync(tsPath)) {
      try {
        context.tsConfig = JSON.parse(readFileSync(tsPath, "utf-8"));
      } catch { /* ignore */ }
    }

    // Git 状态
    try {
      const { execSync } = await import("child_process");
      context.gitStatus = execSync("git status --short", {
        cwd: this.rootDir,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
    } catch { /* not a git repo or git not available */ }

    return context;
  }

  private buildDirectoryTree(dir: string, depth: number): string {
    if (depth > MAX_TREE_DEPTH) return "";

    const lines: string[] = [];
    const indent = "  ".repeat(depth);

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;

        if (entry.isDirectory()) {
          lines.push(`${indent}${entry.name}/`);
          lines.push(this.buildDirectoryTree(join(dir, entry.name), depth + 1));
        } else {
          lines.push(`${indent}${entry.name}`);
        }
      }
    } catch { /* permission error */ }

    return lines.filter(Boolean).join("\n");
  }

  /**
   * 读取文件内容（带大小限制）
   */
  readFile(filePath: string): string | null {
    const fullPath = resolve(this.rootDir, filePath);
    if (!existsSync(fullPath)) return null;

    try {
      const stat = statSync(fullPath);
      if (stat.size > MAX_FILE_SIZE) {
        return `[File too large: ${(stat.size / 1024).toFixed(1)}KB, max ${MAX_FILE_SIZE / 1024}KB]`;
      }
      return readFileSync(fullPath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * 对话历史管理
   */
  addMessage(message: ConversationMessage): void {
    this.messages.push(message);
  }

  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  /**
   * 上下文压缩 — 当消息过多时进行摘要
   */
  compactHistory(keepLast: number = 10): void {
    if (this.messages.length <= keepLast) return;

    const summary: ConversationMessage = {
      role: "system",
      content: `[Previous conversation summarized: ${this.messages.length - keepLast} messages compressed]`,
    };

    this.messages = [summary, ...this.messages.slice(-keepLast)];
  }

  /**
   * 构建系统提示
   */
  buildSystemPrompt(projectContext: ProjectContext): string {
    const parts = [
      "You are SaCode, an AI coding assistant with access to tools for reading, writing, and searching files, and executing shell commands.",
      "",
      "## Project Context",
      `Working directory: ${projectContext.rootDir}`,
    ];

    if (projectContext.packageJson) {
      const pkg = projectContext.packageJson as Record<string, string>;
      parts.push(`Project: ${pkg.name || "unknown"} v${pkg.version || "0.0.0"}`);
    }

    if (projectContext.directoryTree) {
      parts.push("", "## Directory Structure", "```", projectContext.directoryTree.slice(0, 2000), "```");
    }

    if (projectContext.gitStatus) {
      parts.push("", "## Git Status", "```", projectContext.gitStatus, "```");
    }

    parts.push(
      "",
      "## Guidelines",
      "- Read files before modifying them",
      "- Use search before assuming file locations",
      "- Explain your reasoning before making changes",
      "- Ask for confirmation before destructive operations",
    );

    return parts.join("\n");
  }

  clear(): void {
    this.messages = [];
  }
}
