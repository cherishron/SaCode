/**
 * Memory Loader - 记忆加载器
 *
 * 负责加载和管理工作空间的长期记忆
 */

import fs from "fs/promises";
import path from "path";

export interface WorkspaceMemoryEntry {
  date: string;
  content: string;
  importance: number;
}

export interface MemoryLoaderOptions {
  workspacePath: string;
  memoryDir?: string;
  maxEntries?: number;
}

/**
 * 记忆加载器
 */
export class MemoryLoader {
  private workspacePath: string;
  private memoryDir: string;
  private maxEntries: number;
  private cache: WorkspaceMemoryEntry[] = [];

  constructor(options: MemoryLoaderOptions) {
    this.workspacePath = options.workspacePath;
    this.memoryDir = options.memoryDir || "memory";
    this.maxEntries = options.maxEntries || 100;
  }

  /**
   * 加载所有记忆
   */
  async load(): Promise<WorkspaceMemoryEntry[]> {
    const memoryPath = path.join(this.workspacePath, this.memoryDir);

    try {
      const files = await fs.readdir(memoryPath);
      const memoryFiles = files
        .filter((f) => f.endsWith(".md") && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .reverse()
        .slice(0, this.maxEntries);

      const entries: WorkspaceMemoryEntry[] = [];

      for (const file of memoryFiles) {
        const filePath = path.join(memoryPath, file);
        const content = await fs.readFile(filePath, "utf-8");
        const date = file.replace(".md", "");

        // 简单的重要性计算：内容长度作为参考
        const importance = this.calculateImportance(content);

        entries.push({ date, content, importance });
      }

      this.cache = entries;
      return entries;
    } catch {
      // 记忆目录不存在
      return [];
    }
  }

  /**
   * 获取记忆条目
   */
  async get(date: string): Promise<WorkspaceMemoryEntry | null> {
    // 检查缓存
    const cached = this.cache.find((e) => e.date === date);
    if (cached) return cached;

    // 从文件加载
    const filePath = path.join(
      this.workspacePath,
      this.memoryDir,
      `${date}.md`
    );

    try {
      const content = await fs.readFile(filePath, "utf-8");
      return { date, content, importance: this.calculateImportance(content) };
    } catch {
      return null;
    }
  }

  /**
   * 保存记忆
   */
  async save(date: string, content: string): Promise<void> {
    const memoryPath = path.join(this.workspacePath, this.memoryDir);

    // 确保目录存在
    await fs.mkdir(memoryPath, { recursive: true });

    const filePath = path.join(memoryPath, `${date}.md`);
    await fs.writeFile(filePath, content, "utf-8");

    // 更新缓存
    const existing = this.cache.findIndex((e) => e.date === date);
    const entry: WorkspaceMemoryEntry = {
      date,
      content,
      importance: this.calculateImportance(content),
    };

    if (existing >= 0) {
      this.cache[existing] = entry;
    } else {
      this.cache.unshift(entry);
      // 保持缓存大小
      if (this.cache.length > this.maxEntries) {
        this.cache = this.cache.slice(0, this.maxEntries);
      }
    }
  }

  /**
   * 搜索记忆
   */
  async search(query: string): Promise<WorkspaceMemoryEntry[]> {
    const entries = await this.load();
    const lowerQuery = query.toLowerCase();

    return entries.filter((entry) =>
      entry.content.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 获取重要记忆
   */
  async getImportant(threshold: number = 0.5): Promise<WorkspaceMemoryEntry[]> {
    const entries = await this.load();
    return entries.filter((e) => e.importance >= threshold);
  }

  /**
   * 获取今日记忆
   */
  async getToday(): Promise<WorkspaceMemoryEntry | null> {
    const today = new Date().toISOString().split("T")[0] ?? "";
    return this.get(today);
  }

  /**
   * 清除记忆缓存
   */
  clearCache(): void {
    this.cache = [];
  }

  /**
   * 计算重要性
   */
  private calculateImportance(content: string): number {
    // 简单的重要性计算
    // 实际可以根据关键词、用户标记等来计算
    const baseLength = Math.min(content.length / 1000, 1); // 最大1000字符

    // 检查关键词
    const importantKeywords = [
      "重要",
      "关键",
      "决定",
      "偏好",
      "喜欢",
      "不喜欢",
      "过敏",
      "禁忌",
    ];

    let keywordBonus = 0;
    for (const keyword of importantKeywords) {
      if (content.includes(keyword)) {
        keywordBonus += 0.1;
      }
    }

    return Math.min(baseLength + keywordBonus, 1);
  }
}

/**
 * 创建记忆加载器
 */
export function createMemoryLoader(
  options: MemoryLoaderOptions
): MemoryLoader {
  return new MemoryLoader(options);
}
