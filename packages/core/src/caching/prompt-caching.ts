/**
 * Prompt Caching 架构
 *
 * 支持 Anthropic prompt-caching 特性，优化 token 使用
 */

import type { ChatMessage, ToolDefinition } from "../provider";

/**
 * 缓存控制类型
 */
export interface CacheControl {
  type: "ephemeral";
}

/**
 * 带缓存控制的消息
 */
export interface CachedMessage extends ChatMessage {
  cache_control?: CacheControl;
}

/**
 * 带缓存控制的工具定义
 */
export interface CachedToolDefinition extends ToolDefinition {
  cache_control?: CacheControl;
}

/**
 * 缓存策略
 */
export type CacheStrategy =
  | "auto"      // 自动决定缓存位置
  | "system"    // 缓存系统提示
  | "tools"     // 缓存工具定义
  | "messages"  // 缓存消息历史
  | "all"       // 缓存所有可缓存内容
  | "none";     // 不使用缓存

/**
 * Prompt Caching 配置
 */
export interface PromptCachingConfig {
  /** 是否启用缓存 */
  enabled: boolean;
  /** 缓存策略 */
  strategy: CacheStrategy;
  /** 最小缓存 token 数（Anthropic 最小 1024） */
  minTokens: number;
  /** 最大缓存消息数 */
  maxCachedMessages: number;
  /** 是否缓存工具定义 */
  cacheTools: boolean;
  /** 是否缓存系统提示 */
  cacheSystemPrompt: boolean;
  /** 缓存生命周期（秒） */
  cacheTTL: number;
}

/**
 * 默认配置
 */
export const DEFAULT_PROMPT_CACHING_CONFIG: PromptCachingConfig = {
  enabled: true,
  strategy: "auto",
  minTokens: 1024,
  maxCachedMessages: 4,
  cacheTools: true,
  cacheSystemPrompt: true,
  cacheTTL: 300, // 5 分钟
};

/**
 * 缓存统计
 */
export interface CacheStats {
  /** 缓存命中次数 */
  hits: number;
  /** 缓存未命中次数 */
  misses: number;
  /** 创建的缓存数 */
  created: number;
  /** 节省的 token 数 */
  tokensSaved: number;
  /** 缓存大小（字节） */
  cacheSize: number;
  /** 命中率 */
  hitRate: number;
}

/**
 * Prompt Caching 管理器
 *
 * @example
 * ```typescript
 * const caching = new PromptCachingManager({
 *   strategy: "auto",
 * });
 *
 * // 处理消息添加缓存控制
 * const cachedMessages = caching.processMessages(messages, tools);
 *
 * // 发送到 Provider
 * const response = await provider.chat({
 *   messages: cachedMessages,
 *   tools: cachedTools,
 * });
 * ```
 */
export class PromptCachingManager {
  private config: PromptCachingConfig;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    created: 0,
    tokensSaved: 0,
    cacheSize: 0,
    hitRate: 0,
  };
  private cache: Map<string, { content: string; createdAt: number }> = new Map();

  constructor(config: Partial<PromptCachingConfig> = {}) {
    this.config = { ...DEFAULT_PROMPT_CACHING_CONFIG, ...config };
  }

  /**
   * 处理消息，添加缓存控制
   */
  processMessages(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): {
    messages: CachedMessage[];
    tools?: CachedToolDefinition[];
  } {
    if (!this.config.enabled) {
      return { messages: messages as CachedMessage[], tools: tools as CachedToolDefinition[] };
    }

    const cachedMessages: CachedMessage[] = [];
    let processedTools: CachedToolDefinition[] | undefined;

    // 根据策略处理
    switch (this.config.strategy) {
      case "auto":
        processedTools = this.processToolsAuto(tools);
        cachedMessages.push(...this.processMessagesAuto(messages));
        break;

      case "system":
        processedTools = this.processToolsAuto(tools);
        cachedMessages.push(...this.processMessagesSystemOnly(messages));
        break;

      case "tools":
        processedTools = this.addCacheControlToTools(tools);
        cachedMessages.push(...(messages as CachedMessage[]));
        break;

      case "messages":
        processedTools = tools as CachedToolDefinition[];
        cachedMessages.push(...this.addCacheControlToMessages(messages));
        break;

      case "all":
        processedTools = this.addCacheControlToTools(tools);
        cachedMessages.push(...this.addCacheControlToMessages(messages));
        break;

      case "none":
      default:
        return { messages: messages as CachedMessage[], tools: tools as CachedToolDefinition[] };
    }

    this.stats.created++;

    return {
      messages: cachedMessages,
      tools: processedTools,
    };
  }

  /**
   * 自动策略：智能决定缓存位置
   */
  private processMessagesAuto(messages: ChatMessage[]): CachedMessage[] {
    const result: CachedMessage[] = [];

    // 第一条系统消息添加缓存
    const systemIndex = messages.findIndex((m) => m.role === "system");
    if (systemIndex !== -1 && this.config.cacheSystemPrompt) {
      const systemMessage = messages[systemIndex];
      if (systemMessage) {
        result.push({
          ...systemMessage,
          cache_control: { type: "ephemeral" },
        });
      }
    }

    // 历史消息的最后几条添加缓存
    const historyMessages = messages.filter((m) => m.role !== "system");
    const cacheCount = Math.min(
      this.config.maxCachedMessages,
      Math.floor(historyMessages.length / 2)
    );

    for (let i = 0; i < historyMessages.length; i++) {
      const message = historyMessages[i];
      if (!message) continue;

      const shouldCache = i >= historyMessages.length - cacheCount * 2;
      result.push({
        ...message,
        cache_control: shouldCache ? { type: "ephemeral" } : undefined,
      });
    }

    return result;
  }

  /**
   * 仅缓存系统消息
   */
  private processMessagesSystemOnly(messages: ChatMessage[]): CachedMessage[] {
    return messages.map((m, index) => {
      if (m.role === "system" && index === 0) {
        return {
          ...m,
          cache_control: { type: "ephemeral" },
        };
      }
      return m as CachedMessage;
    });
  }

  /**
   * 自动处理工具
   */
  private processToolsAuto(tools?: ToolDefinition[]): CachedToolDefinition[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    // 如果工具数量较多，添加缓存
    if (tools.length >= 3 && this.config.cacheTools) {
      return this.addCacheControlToTools(tools);
    }

    return tools as CachedToolDefinition[];
  }

  /**
   * 为工具添加缓存控制
   */
  private addCacheControlToTools(tools?: ToolDefinition[]): CachedToolDefinition[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    // 在最后一个工具上添加缓存控制
    return tools.map((tool, index) => {
      if (index === tools.length - 1) {
        return {
          ...tool,
          cache_control: { type: "ephemeral" },
        };
      }
      return tool as CachedToolDefinition;
    });
  }

  /**
   * 为消息添加缓存控制
   */
  private addCacheControlToMessages(messages: ChatMessage[]): CachedMessage[] {
    return messages.map((m, index) => {
      // 为后半部分消息添加缓存
      if (index >= Math.floor(messages.length / 2)) {
        return {
          ...m,
          cache_control: { type: "ephemeral" },
        };
      }
      return m as CachedMessage;
    });
  }

  /**
   * 记录缓存命中
   */
  recordHit(tokensSaved: number): void {
    this.stats.hits++;
    this.stats.tokensSaved += tokensSaved;
    this.updateHitRate();
  }

  /**
   * 记录缓存未命中
   */
  recordMiss(): void {
    this.stats.misses++;
    this.updateHitRate();
  }

  /**
   * 更新命中率
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * 获取统计信息
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      created: 0,
      tokensSaved: 0,
      cacheSize: 0,
      hitRate: 0,
    };
  }

  /**
   * 启用缓存
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * 禁用缓存
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PromptCachingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): PromptCachingConfig {
    return { ...this.config };
  }
}

/**
 * 创建 Prompt Caching 管理器实例
 */
export function createPromptCachingManager(
  config?: Partial<PromptCachingConfig>
): PromptCachingManager {
  return new PromptCachingManager(config);
}

/**
 * 检查消息是否支持缓存
 */
export function isCacheableMessage(message: ChatMessage): boolean {
  // 系统消息和历史消息可缓存
  if (message.role === "system") return true;
  if (message.role === "user" || message.role === "assistant") return true;
  return false;
}

/**
 * 估算消息 token 数（粗略估算）
 */
export function estimateTokens(content: string): number {
  // 粗略估算：英文约 4 字符 = 1 token，中文约 1 字符 = 2 token
  const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = content.length - chineseChars;
  return Math.ceil(chineseChars * 2 + otherChars / 4);
}
