import * as fs from "fs";
import * as path from "path";
import type { MemoryConfig, SessionMemory, MemoryUpdateEvent } from "./types";
import { MemoryConfigSchema } from "./types";

/**
 * AI 压缩回调函数类型
 *
 * 接收原始记忆内容，返回压缩后的摘要
 */
export type MemoryCompactCallback = (content: string, sessionId: string) => Promise<string>;

/**
 * 会话记忆管理器
 *
 * 管理每个会话的持久化记忆，支持：
 * - 读取/更新会话记忆
 * - 自动压缩长记忆（支持 AI 辅助）
 * - 记忆模板初始化
 *
 * @example
 * ```typescript
 * const memory = new MemoryManager({ sessionsDir: "sessions" });
 * await memory.initSession("session-123");
 * const content = await memory.getSessionMemory("session-123");
 * await memory.updateSessionMemory("session-123", "用户偏好：喜欢使用 TypeScript");
 * ```
 */
export class MemoryManager {
  private config: MemoryConfig;
  private cache: Map<string, SessionMemory> = new Map();
  private eventListeners: Map<string, ((event: MemoryUpdateEvent) => void)[]> = new Map();
  private compactCallback: MemoryCompactCallback | null = null;

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = MemoryConfigSchema.parse(config);
  }

  /**
   * 设置 AI 压缩回调
   *
   * 启用后，compactMemory 将使用 AI 生成高质量摘要，
   * 而非简单的行过滤。回调函数接收原始内容和会话 ID，
   * 返回压缩后的摘要文本。
   *
   * @example
   * ```typescript
   * memory.setCompactCallback(async (content, sessionId) => {
   *   const response = await provider.chat({
   *     messages: [
   *       { role: "system", content: "请将以下会话记忆压缩为简洁的摘要..." },
   *       { role: "user", content },
   *     ],
   *   });
   *   return response.content;
   * });
   * ```
   */
  setCompactCallback(callback: MemoryCompactCallback): void {
    this.compactCallback = callback;
  }

  /**
   * 初始化会话记忆
   */
  async initSession(sessionId: string, template?: string): Promise<SessionMemory> {
    const sessionDir = this.resolveSessionDir(sessionId);
    const memoryFile = path.join(sessionDir, this.config.memoryFileName);

    // 创建目录
    if (!fs.existsSync(sessionDir)) {
      await fs.promises.mkdir(sessionDir, { recursive: true });
    }

    // 如果文件不存在，创建初始记忆
    if (!fs.existsSync(memoryFile)) {
      const initialContent = template ?? this.getDefaultTemplate(sessionId);
      await fs.promises.writeFile(memoryFile, initialContent, "utf-8");

      const memory: SessionMemory = {
        sessionId,
        content: initialContent,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
      };

      this.cache.set(sessionId, memory);
      this.emit("create", sessionId, 0, initialContent.length);

      return memory;
    }

    // 已存在，读取现有记忆
    return this.getSessionMemory(sessionId);
  }

  /**
   * 获取会话记忆
   */
  async getSessionMemory(sessionId: string): Promise<SessionMemory> {
    // 检查缓存
    const cached = this.cache.get(sessionId);
    if (cached) {
      return cached;
    }

    const sessionDir = this.resolveSessionDir(sessionId);
    const memoryFile = path.join(sessionDir, this.config.memoryFileName);

    if (!fs.existsSync(memoryFile)) {
      throw new Error(`Session memory not found: ${sessionId}`);
    }

    const content = await fs.promises.readFile(memoryFile, "utf-8");
    const stats = await fs.promises.stat(memoryFile);

    const memory: SessionMemory = {
      sessionId,
      content,
      createdAt: stats.birthtime,
      updatedAt: stats.mtime,
      metadata: {},
    };

    this.cache.set(sessionId, memory);
    return memory;
  }

  /**
   * 更新会话记忆
   * 
   * @param sessionId 会话 ID
   * @param content 新内容（追加或替换）
   * @param mode 更新模式
   */
  async updateSessionMemory(
    sessionId: string,
    content: string,
    mode: "append" | "replace" = "append"
  ): Promise<SessionMemory> {
    const sessionDir = this.resolveSessionDir(sessionId);
    const memoryFile = path.join(sessionDir, this.config.memoryFileName);

    // 确保会话目录存在
    if (!fs.existsSync(sessionDir)) {
      await fs.promises.mkdir(sessionDir, { recursive: true });
    }

    let previousSize = 0;
    let currentMemory: SessionMemory;

    if (mode === "append" && fs.existsSync(memoryFile)) {
      const existing = await this.getSessionMemory(sessionId);
      previousSize = existing.content.length;
      
      // 追加内容，带时间戳
      const timestamp = new Date().toISOString();
      const newContent = `${existing.content}\n\n---\n\n<!-- ${timestamp} -->\n${content}`;
      
      // 检查是否需要压缩
      if (this.config.autoCompact && newContent.length > this.config.compactThreshold) {
        const compacted = await this.compactMemory(sessionId, newContent);
        currentMemory = compacted;
      } else {
        await fs.promises.writeFile(memoryFile, newContent, "utf-8");
        currentMemory = {
          sessionId,
          content: newContent,
          createdAt: existing.createdAt,
          updatedAt: new Date(),
          metadata: existing.metadata,
        };
      }
    } else {
      // 替换模式
      if (fs.existsSync(memoryFile)) {
        const existing = await this.getSessionMemory(sessionId);
        previousSize = existing.content.length;
      }

      await fs.promises.writeFile(memoryFile, content, "utf-8");
      currentMemory = {
        sessionId,
        content,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
      };
    }

    this.cache.set(sessionId, currentMemory);
    this.emit("update", sessionId, previousSize, currentMemory.content.length);

    return currentMemory;
  }

  /**
   * 压缩记忆
   *
   * 优先使用 AI 辅助压缩（通过 setCompactCallback 设置），
   * 若未设置 AI 回调，则使用基于规则的简单压缩。
   */
  async compactMemory(sessionId: string, content?: string): Promise<SessionMemory> {
    const sessionDir = this.resolveSessionDir(sessionId);
    const memoryFile = path.join(sessionDir, this.config.memoryFileName);

    const rawContent = content ?? (await this.getSessionMemory(sessionId)).content;
    const previousSize = rawContent.length;

    let finalContent: string;

    if (this.compactCallback) {
      // AI 辅助压缩
      try {
        const aiSummary = await this.compactCallback(rawContent, sessionId);
        finalContent = `# 会话记忆 (AI 压缩)\n\n最后更新: ${new Date().toISOString()}\n\n${aiSummary}`;
      } catch (e) {
        // AI 压缩失败时回退到规则压缩
        finalContent = this.ruleBasedCompact(rawContent);
      }
    } else {
      // 基于规则的简单压缩
      finalContent = this.ruleBasedCompact(rawContent);
    }

    await fs.promises.writeFile(memoryFile, finalContent, "utf-8");

    const memory: SessionMemory = {
      sessionId,
      content: finalContent,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { compacted: true },
    };

    this.cache.set(sessionId, memory);
    this.emit("compact", sessionId, previousSize, finalContent.length);

    return memory;
  }

  /**
   * 基于规则的简单压缩
   *
   * 保留标题行、重要标记行和关键部分
   */
  private ruleBasedCompact(rawContent: string): string {
    const lines = rawContent.split("\n");
    const compressed: string[] = [];
    let inImportantSection = false;

    for (const line of lines) {
      if (line.startsWith("#")) {
        compressed.push(line);
        inImportantSection = line.includes("重要") || line.includes("偏好") || line.includes("设置");
        continue;
      }

      if (inImportantSection) {
        compressed.push(line);
        continue;
      }

      if (line.includes("重要:") || line.includes("注意:") || line.includes("偏好:")) {
        compressed.push(line);
      }
    }

    const compactedContent = compressed.join("\n").trim();
    return `# 会话记忆 (已压缩)\n\n最后更新: ${new Date().toISOString()}\n\n${compactedContent}`;
  }

  /**
   * 删除会话记忆
   */
  async deleteSessionMemory(sessionId: string): Promise<boolean> {
    const sessionDir = this.resolveSessionDir(sessionId);

    if (!fs.existsSync(sessionDir)) {
      return false;
    }

    const memory = await this.getSessionMemory(sessionId).catch(() => null);
    const previousSize = memory?.content.length ?? 0;

    await fs.promises.rm(sessionDir, { recursive: true, force: true });
    this.cache.delete(sessionId);

    this.emit("delete", sessionId, previousSize, 0);

    return true;
  }

  /**
   * 搜索记忆
   *
   * 在所有会话记忆中搜索匹配的内容
   */
  async searchMemory(query: string, limit: number = 10): Promise<Array<{ sessionId: string; content: string; relevance: number }>> {
    const sessions = await this.listSessions();
    const results: Array<{ sessionId: string; content: string; relevance: number }> = [];
    const lowerQuery = query.toLowerCase();
    const queryTerms = lowerQuery.split(/\s+/).filter(Boolean);

    for (const sessionId of sessions) {
      try {
        const memory = await this.getSessionMemory(sessionId);
        const lowerContent = memory.content.toLowerCase();

        let relevance = 0;
        for (const term of queryTerms) {
          const count = (lowerContent.match(new RegExp(term, "g")) ?? []).length;
          relevance += count;
        }

        if (relevance > 0) {
          const snippetStart = lowerContent.indexOf(queryTerms[0] ?? "");
          const start = Math.max(0, snippetStart - 50);
          const end = Math.min(memory.content.length, snippetStart + 200);
          const snippet = memory.content.slice(start, end);

          results.push({
            sessionId,
            content: snippet,
            relevance,
          });
        }
      } catch {
        // 跳过无法读取的会话
      }
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, limit);
  }

  /**
   * 列出所有会话
   */
  async listSessions(): Promise<string[]> {
    const sessionsDir = this.resolveSessionsDir();

    if (!fs.existsSync(sessionsDir)) {
      return [];
    }

    const entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  /**
   * 构建记忆提示词
   * 
   * 将会话记忆格式化为可注入到系统提示的格式
   */
  buildMemoryPrompt(sessionId: string): string {
    const memory = this.cache.get(sessionId);
    if (!memory) {
      return "";
    }

    return `# 会话记忆

以下是与该会话相关的重要信息，请在回复时参考：

${memory.content}
`;
  }

  /**
   * 注册事件监听器
   */
  on(event: string, listener: (event: MemoryUpdateEvent) => void): void {
    const listeners = this.eventListeners.get(event) ?? [];
    listeners.push(listener);
    this.eventListeners.set(event, listeners);
  }

  /**
   * 解析会话目录路径
   */
  private resolveSessionDir(sessionId: string): string {
    const base = this.resolveSessionsDir();
    return path.join(base, sessionId);
  }

  /**
   * 解析会话存储根目录
   */
  private resolveSessionsDir(): string {
    if (path.isAbsolute(this.config.sessionsDir)) {
      return this.config.sessionsDir;
    }
    return path.resolve(process.cwd(), this.config.sessionsDir);
  }

  /**
   * 获取默认记忆模板
   */
  private getDefaultTemplate(sessionId: string): string {
    return `# 会话记忆

> 会话 ID: ${sessionId}
> 创建时间: ${new Date().toISOString()}

## 用户偏好

（在此记录用户的偏好和习惯）

## 重要信息

（在此记录会话中的重要信息）

## 任务历史

（在此记录已完成和进行中的任务）
`;
  }

  /**
   * 触发事件
   */
  private emit(
    action: MemoryUpdateEvent["action"],
    sessionId: string,
    previousSize: number,
    currentSize: number
  ): void {
    const event: MemoryUpdateEvent = {
      sessionId,
      action,
      timestamp: new Date(),
      previousSize,
      currentSize,
    };

    const listeners = this.eventListeners.get(action) ?? [];
    for (const listener of listeners) {
      listener(event);
    }
  }
}

/**
 * 创建记忆管理器实例
 */
export function createMemoryManager(config?: Partial<MemoryConfig>): MemoryManager {
  return new MemoryManager(config);
}
