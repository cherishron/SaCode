/**
 * 记忆系统 - 双文件模式
 *
 * 参考 Claude Code 记忆系统设计：
 * - MEMORY.md: 索引文件（最多 200 行）
 * - *.md: 记忆文件（按类型分类）
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 记忆类型
 */
export type MemoryType =
  | "user"       // 用户偏好和角色
  | "project"    // 项目上下文
  | "feedback"   // 反馈（需要重复/避免的行为）
  | "reference"  // 参考文档
  | "session";   // 会话记忆

/**
 * 记忆条目
 */
export interface MemoryEntry {
  /** 文件名 */
  file: string;
  /** 记忆类型 */
  type: MemoryType;
  /** 简短描述（用于索引） */
  summary: string;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/**
 * 记忆索引
 */
export interface MemoryIndex {
  /** 索引版本 */
  version: string;
  /** 最后更新时间 */
  lastUpdated: string;
  /** 记忆条目 */
  entries: MemoryEntry[];
}

/**
 * 记忆管理器配置
 */
export interface MemoryManagerConfig {
  /** 记忆目录路径 */
  memoryDir: string;
  /** 索引文件名 */
  indexFile?: string;
  /** 最大索引行数 */
  maxIndexLines?: number;
}

// ============================================================================
// 记忆管理器
// ============================================================================

/**
 * 记忆管理器
 *
 * 实现双文件模式的记忆系统：
 * - recall(): 使用 LLM 搜索相关记忆
 * - remember(): 添加新记忆
 * - forget(): 移除记忆
 * - consolidate(): 合并相似记忆
 */
export class MemoryManager {
  private memoryDir: string;
  private indexFile: string;
  private maxIndexLines: number;
  private index: MemoryIndex | null = null;

  constructor(config: MemoryManagerConfig) {
    this.memoryDir = config.memoryDir;
    this.indexFile = config.indexFile ?? "MEMORY.md";
    this.maxIndexLines = config.maxIndexLines ?? 200;
  }

  /**
   * 初始化记忆系统
   */
  async initialize(): Promise<void> {
    // 确保目录存在
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }

    // 加载或创建索引
    await this.loadIndex();
  }

  /**
   * 加载索引
   */
  private async loadIndex(): Promise<void> {
    const indexPath = path.join(this.memoryDir, this.indexFile);

    if (fs.existsSync(indexPath)) {
      try {
        const content = fs.readFileSync(indexPath, "utf-8");
        this.index = this.parseIndex(content);
      } catch {
        this.index = this.createEmptyIndex();
      }
    } else {
      this.index = this.createEmptyIndex();
    }
  }

  /**
   * 创建空索引
   */
  private createEmptyIndex(): MemoryIndex {
    return {
      version: "1.0.0",
      lastUpdated: new Date().toISOString(),
      entries: [],
    };
  }

  /**
   * 解析索引文件
   */
  private parseIndex(content: string): MemoryIndex {
    const entries: MemoryEntry[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      // 解析格式: - filename: summary (type)
      const match = line.match(/^- `?([^`:\n]+)`?: (.+?) \(([a-z]+)\)$/);
      if (match) {
        entries.push({
          file: match[1]!.trim(),
          summary: match[2]!.trim(),
          type: match[3]!.trim() as MemoryType,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    return {
      version: "1.0.0",
      lastUpdated: new Date().toISOString(),
      entries,
    };
  }

  /**
   * 保存索引
   */
  private async saveIndex(): Promise<void> {
    if (!this.index) return;

    const indexPath = path.join(this.memoryDir, this.indexFile);
    const content = this.generateIndexContent();

    fs.writeFileSync(indexPath, content, "utf-8");
  }

  /**
   * 生成索引内容
   */
  private generateIndexContent(): string {
    if (!this.index) return "";

    const lines: string[] = [
      `# Memory Index`,
      ``,
      `> Last updated: ${this.index.lastUpdated}`,
      ``,
    ];

    // 按类型分组
    const grouped = new Map<MemoryType, MemoryEntry[]>();

    for (const entry of this.index.entries) {
      const group = grouped.get(entry.type) ?? [];
      group.push(entry);
      grouped.set(entry.type, group);
    }

    // 生成内容
    const typeLabels: Record<MemoryType, string> = {
      user: "User Context",
      project: "Project Context",
      feedback: "Feedback",
      reference: "Reference",
      session: "Session Memory",
    };

    for (const [type, entries] of grouped) {
      lines.push(`## ${typeLabels[type] ?? type}`);
      for (const entry of entries) {
        lines.push(`- \`${entry.file}\`: ${entry.summary} (${entry.type})`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * 检索记忆
   *
   * @param query 搜索查询
   * @param topK 返回的最大结果数
   * @returns 相关记忆内容列表
   */
  async recall(query: string, topK: number = 5): Promise<string[]> {
    if (!this.index || this.index.entries.length === 0) {
      return [];
    }

    // 简单的关键词匹配（实际应使用 LLM 进行语义搜索）
    const queryWords = query.toLowerCase().split(/\s+/);
    const scored: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const entry of this.index.entries) {
      const text = `${entry.file} ${entry.summary} ${entry.type}`.toLowerCase();
      let score = 0;

      for (const word of queryWords) {
        if (text.includes(word)) {
          score += 1;
        }
      }

      if (score > 0) {
        scored.push({ entry, score });
      }
    }

    // 排序并取 topK
    scored.sort((a, b) => b.score - a.score);
    const topEntries = scored.slice(0, topK).map((s) => s.entry);

    // 读取文件内容
    const results: string[] = [];

    for (const entry of topEntries) {
      const filePath = path.join(this.memoryDir, entry.file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        results.push(`## ${entry.file}\n\n${content}`);
      }
    }

    return results;
  }

  /**
   * 记忆内容
   *
   * @param content 记忆内容
   * @param type 记忆类型
   * @param summary 简短描述（可选）
   */
  async remember(
    content: string,
    type: MemoryType,
    summary?: string
  ): Promise<void> {
    if (!this.index) {
      await this.initialize();
    }

    // 生成文件名
    const timestamp = Date.now();
    const filename = `${type}_${timestamp}.md`;
    const filePath = path.join(this.memoryDir, filename);

    // 写入文件
    const fileContent = `# ${type.charAt(0).toUpperCase() + type.slice(1)} Memory\n\n${content}\n`;
    fs.writeFileSync(filePath, fileContent, "utf-8");

    // 更新索引
    const entry: MemoryEntry = {
      file: filename,
      type,
      summary: summary ?? content.slice(0, 80).replace(/\n/g, " "),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.index!.entries.push(entry);
    this.index!.lastUpdated = new Date().toISOString();

    // 保存索引
    await this.saveIndex();
  }

  /**
   * 遗忘记忆
   *
   * @param query 搜索查询（匹配要删除的记忆）
   */
  async forget(query: string): Promise<boolean> {
    if (!this.index) return false;

    const queryLower = query.toLowerCase();
    const index = this.index.entries.findIndex(
      (e) =>
        e.file.toLowerCase().includes(queryLower) ||
        e.summary.toLowerCase().includes(queryLower)
    );

    if (index === -1) return false;

    const entry = this.index.entries[index];

    // 删除文件
    const filePath = path.join(this.memoryDir, entry.file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // 更新索引
    this.index.entries.splice(index, 1);
    this.index.lastUpdated = new Date().toISOString();

    await this.saveIndex();
    return true;
  }

  /**
   * 整合记忆（合并相似记忆）
   */
  async consolidate(): Promise<void> {
    if (!this.index) return;

    // TODO: 实现 LLM 辅助的记忆整合
    // 1. 识别相似记忆
    // 2. 合并内容
    // 3. 更新索引
  }

  /**
   * 获取所有记忆
   */
  getAll(): MemoryEntry[] {
    return this.index?.entries ?? [];
  }

  /**
   * 获取指定类型的记忆
   */
  getByType(type: MemoryType): MemoryEntry[] {
    return this.index?.entries.filter((e) => e.type === type) ?? [];
  }

  /**
   * 清除所有记忆
   */
  async clear(): Promise<void> {
    if (!this.index) return;

    // 删除所有记忆文件
    for (const entry of this.index.entries) {
      const filePath = path.join(this.memoryDir, entry.file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // 重置索引
    this.index = this.createEmptyIndex();
    await this.saveIndex();
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建记忆管理器
 */
export function createMemoryManager(config: MemoryManagerConfig): MemoryManager {
  return new MemoryManager(config);
}

/**
 * 获取默认记忆目录
 */
export function getDefaultMemoryDir(): string {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(homeDir, ".sacode", "memory");
}

// ============================================================================
// 导出
// ============================================================================

export default MemoryManager;
