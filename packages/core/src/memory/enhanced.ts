/**
 * 增强版记忆管理器
 * 
 * 支持 SQLite 存储 + 向量搜索
 */

import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import type { SessionMemory, MemoryUpdateEvent } from "./types";

// ============================================
// 配置和类型定义
// ============================================

export const EnhancedMemoryConfigSchema = z.object({
  /** 数据库路径 */
  dbPath: z.string().default("./data/memory.db"),
  /** 是否启用向量搜索 */
  enableVectorSearch: z.boolean().default(true),
  /** 向量嵌入模型（openai、gemini、local） */
  embeddingModel: z.enum(["openai", "gemini", "local"]).default("openai"),
  /** 向量维度 */
  vectorDimension: z.number().default(1536),
  /** 搜索结果数量限制 */
  searchLimit: z.number().default(10),
  /** 最小相似度阈值 */
  minSimilarity: z.number().default(0.5),
  /** 会话存储目录（用于 MEMORY.md 文件） */
  sessionsDir: z.string().default("sessions"),
  /** 记忆文件名 */
  memoryFileName: z.string().default("MEMORY.md"),
  /** 是否自动压缩 */
  autoCompact: z.boolean().default(true),
  /** 压缩阈值（字符） */
  compactThreshold: z.number().default(50000),
});

export type EnhancedMemoryConfig = z.infer<typeof EnhancedMemoryConfigSchema>;

/**
 * 记忆条目
 */
export interface MemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 搜索结果
 */
export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

/**
 * 嵌入服务接口
 */
export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ============================================
// 简单的 SQLite 内存存储
// ============================================

/**
 * 内存存储条目（简化版，不依赖 better-sqlite3）
 */
interface MemoryStore {
  entries: Map<string, MemoryEntry>;
  sessionIndex: Map<string, Set<string>>; // sessionId -> entryIds
}

// ============================================
// 增强版记忆管理器
// ============================================

export class EnhancedMemoryManager {
  private config: EnhancedMemoryConfig;
  private store: MemoryStore;
  private cache: Map<string, SessionMemory> = new Map();
  private eventListeners: Map<string, ((event: MemoryUpdateEvent) => void)[]> = new Map();
  private embeddingService?: EmbeddingService;

  constructor(config: Partial<EnhancedMemoryConfig> = {}) {
    this.config = EnhancedMemoryConfigSchema.parse(config);
    this.store = {
      entries: new Map(),
      sessionIndex: new Map(),
    };
  }

  /**
   * 设置嵌入服务
   */
  setEmbeddingService(service: EmbeddingService): void {
    this.embeddingService = service;
  }

  /**
   * 初始化会话记忆
   */
  async initSession(sessionId: string, template?: string): Promise<SessionMemory> {
    const memory: SessionMemory = {
      sessionId,
      content: template ?? this.getDefaultTemplate(sessionId),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
    };

    this.cache.set(sessionId, memory);
    this.emit("create", sessionId, 0, memory.content.length);

    return memory;
  }

  /**
   * 获取会话记忆
   */
  async getSessionMemory(sessionId: string): Promise<SessionMemory> {
    const cached = this.cache.get(sessionId);
    if (cached) {
      return cached;
    }

    // 尝试从文件加载
    const memoryFile = this.resolveMemoryFile(sessionId);
    if (fs.existsSync(memoryFile)) {
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

    throw new Error(`Session memory not found: ${sessionId}`);
  }

  /**
   * 更新会话记忆
   */
  async updateSessionMemory(
    sessionId: string,
    content: string,
    mode: "append" | "replace" = "append"
  ): Promise<SessionMemory> {
    let previousSize = 0;
    let currentMemory: SessionMemory;

    if (mode === "append") {
      const existing = await this.getSessionMemory(sessionId).catch(() => null);
      previousSize = existing?.content.length ?? 0;

      const timestamp = new Date().toISOString();
      const newContent = existing
        ? `${existing.content}\n\n---\n\n<!-- ${timestamp} -->\n${content}`
        : content;

      // 检查是否需要压缩
      if (this.config.autoCompact && newContent.length > this.config.compactThreshold) {
        currentMemory = await this.compactMemory(sessionId, newContent);
      } else {
        currentMemory = {
          sessionId,
          content: newContent,
          createdAt: existing?.createdAt ?? new Date(),
          updatedAt: new Date(),
          metadata: existing?.metadata ?? {},
        };
      }
    } else {
      const existing = await this.getSessionMemory(sessionId).catch(() => null);
      previousSize = existing?.content.length ?? 0;

      currentMemory = {
        sessionId,
        content,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
        metadata: existing?.metadata ?? {},
      };
    }

    // 保存到文件
    const memoryFile = this.resolveMemoryFile(sessionId);
    await fs.promises.mkdir(path.dirname(memoryFile), { recursive: true });
    await fs.promises.writeFile(memoryFile, currentMemory.content, "utf-8");

    this.cache.set(sessionId, currentMemory);
    this.emit("update", sessionId, previousSize, currentMemory.content.length);

    return currentMemory;
  }

  /**
   * 添加记忆条目（支持向量搜索）
   */
  async addEntry(
    sessionId: string,
    content: string,
    metadata: Record<string, unknown> = {}
  ): Promise<MemoryEntry> {
    const id = this.generateId();
    const entry: MemoryEntry = {
      id,
      sessionId,
      content,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 生成嵌入向量
    if (this.config.enableVectorSearch && this.embeddingService) {
      try {
        entry.embedding = await this.embeddingService.embed(content);
      } catch (error) {
        console.error("Failed to generate embedding:", error);
      }
    }

    // 存储条目
    this.store.entries.set(id, entry);

    // 更新会话索引
    let sessionEntries = this.store.sessionIndex.get(sessionId);
    if (!sessionEntries) {
      sessionEntries = new Set();
      this.store.sessionIndex.set(sessionId, sessionEntries);
    }
    sessionEntries.add(id);

    return entry;
  }

  /**
   * 语义搜索
   */
  async search(
    query: string,
    options: {
      sessionId?: string;
      limit?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<MemorySearchResult[]> {
    const {
      sessionId,
      limit = this.config.searchLimit,
      minSimilarity = this.config.minSimilarity,
    } = options;

    // 如果没有嵌入服务，使用简单的文本匹配
    if (!this.embeddingService) {
      return this.textSearch(query, sessionId, limit);
    }

    // 生成查询向量
    const queryEmbedding = await this.embeddingService.embed(query);

    // 获取候选条目
    const candidates: MemoryEntry[] = [];
    if (sessionId) {
      const entryIds = this.store.sessionIndex.get(sessionId);
      if (entryIds) {
        for (const id of entryIds) {
          const entry = this.store.entries.get(id);
          if (entry && entry.embedding) {
            candidates.push(entry);
          }
        }
      }
    } else {
      for (const entry of this.store.entries.values()) {
        if (entry.embedding) {
          candidates.push(entry);
        }
      }
    }

    // 计算相似度
    const results: MemorySearchResult[] = [];
    for (const entry of candidates) {
      if (entry.embedding) {
        const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
        if (similarity >= minSimilarity) {
          results.push({ entry, score: similarity });
        }
      }
    }

    // 按相似度排序并限制数量
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * 文本搜索（备用方案）
   */
  private textSearch(query: string, sessionId?: string, limit?: number): MemorySearchResult[] {
    const queryLower = query.toLowerCase();
    const results: MemorySearchResult[] = [];

    const candidates = sessionId
      ? (this.store.sessionIndex.get(sessionId) ?? new Set())
      : new Set(this.store.entries.keys());

    for (const id of candidates) {
      const entry = this.store.entries.get(id);
      if (entry && entry.content.toLowerCase().includes(queryLower)) {
        // 简单的 BM25 风格评分
        const score = this.calculateBM25Score(query, entry.content);
        results.push({ entry, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit ?? this.config.searchLimit);
  }

  /**
   * 简化的 BM25 评分
   */
  private calculateBM25Score(query: string, content: string): number {
    const terms = query.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    let score = 0;

    for (const term of terms) {
      const regex = new RegExp(term, "gi");
      const matches = contentLower.match(regex);
      const tf = matches ? matches.length : 0;
      score += tf / (tf + 2); // 简化的 BM25
    }

    return score / terms.length;
  }

  /**
   * 余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same dimension");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 压缩记忆
   */
  async compactMemory(sessionId: string, content?: string): Promise<SessionMemory> {
    const rawContent = content ?? (await this.getSessionMemory(sessionId)).content;
    const previousSize = rawContent.length;

    // 简单的压缩：保留重要行
    const lines = rawContent.split("\n");
    const compressed: string[] = [];

    for (const line of lines) {
      if (
        line.startsWith("#") ||
        line.includes("重要:") ||
        line.includes("注意:") ||
        line.includes("偏好:")
      ) {
        compressed.push(line);
      }
    }

    const compactedContent = `# 会话记忆 (已压缩)\n\n最后更新: ${new Date().toISOString()}\n\n${compressed.join("\n").trim()}`;

    const memory: SessionMemory = {
      sessionId,
      content: compactedContent,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { compacted: true },
    };

    // 保存到文件
    const memoryFile = this.resolveMemoryFile(sessionId);
    await fs.promises.mkdir(path.dirname(memoryFile), { recursive: true });
    await fs.promises.writeFile(memoryFile, compactedContent, "utf-8");

    this.cache.set(sessionId, memory);
    this.emit("compact", sessionId, previousSize, compactedContent.length);

    return memory;
  }

  /**
   * 删除会话记忆
   */
  async deleteSessionMemory(sessionId: string): Promise<boolean> {
    const memory = await this.getSessionMemory(sessionId).catch(() => null);
    const previousSize = memory?.content.length ?? 0;

    // 删除文件
    const memoryFile = this.resolveMemoryFile(sessionId);
    if (fs.existsSync(memoryFile)) {
      await fs.promises.unlink(memoryFile);
    }

    // 清理缓存
    this.cache.delete(sessionId);

    // 清理存储
    const entryIds = this.store.sessionIndex.get(sessionId);
    if (entryIds) {
      for (const id of entryIds) {
        this.store.entries.delete(id);
      }
      this.store.sessionIndex.delete(sessionId);
    }

    this.emit("delete", sessionId, previousSize, 0);
    return true;
  }

  /**
   * 获取会话的所有条目
   */
  getSessionEntries(sessionId: string): MemoryEntry[] {
    const entryIds = this.store.sessionIndex.get(sessionId);
    if (!entryIds) return [];

    return Array.from(entryIds)
      .map((id) => this.store.entries.get(id))
      .filter((e): e is MemoryEntry => e !== undefined);
  }

  /**
   * 构建记忆提示词
   */
  buildMemoryPrompt(sessionId: string): string {
    const memory = this.cache.get(sessionId);
    if (!memory) return "";

    return `# 会话记忆\n\n以下是与该会话相关的重要信息：\n\n${memory.content}\n`;
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
   * 获取统计信息
   */
  getStats(): {
    sessions: number;
    entries: number;
    cacheSize: number;
  } {
    return {
      sessions: this.store.sessionIndex.size,
      entries: this.store.entries.size,
      cacheSize: this.cache.size,
    };
  }

  // ============================================
  // 私有方法
  // ============================================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private resolveMemoryFile(sessionId: string): string {
    const base = path.isAbsolute(this.config.sessionsDir)
      ? this.config.sessionsDir
      : path.resolve(process.cwd(), this.config.sessionsDir);
    return path.join(base, sessionId, this.config.memoryFileName);
  }

  private getDefaultTemplate(sessionId: string): string {
    return `# 会话记忆\n\n> 会话 ID: ${sessionId}\n> 创建时间: ${new Date().toISOString()}\n\n## 用户偏好\n\n## 重要信息\n\n## 任务历史\n`;
  }

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

// ============================================
// 嵌入服务实现
// ============================================

/**
 * OpenAI 嵌入服务
 */
export class OpenAIEmbeddingService implements EmbeddingService {
  private apiKey: string;
  private model: string;
  private endpoint: string;

  constructor(config: { apiKey: string; model?: string; endpoint?: string }) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "text-embedding-3-small";
    this.endpoint = config.endpoint ?? "https://api.openai.com/v1/embeddings";
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: this.model,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0]!.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return data.data.map((item) => item.embedding);
  }
}

// ============================================
// 工厂函数
// ============================================

export function createEnhancedMemoryManager(config?: Partial<EnhancedMemoryConfig>): EnhancedMemoryManager {
  return new EnhancedMemoryManager(config);
}

export function createOpenAIEmbeddingService(config: {
  apiKey: string;
  model?: string;
  endpoint?: string;
}): OpenAIEmbeddingService {
  return new OpenAIEmbeddingService(config);
}
