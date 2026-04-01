/**
 * 上下文智能管理
 *
 * 提供 Token 计数、自动摘要、上下文压缩功能
 */

import type { ChatMessage } from "../provider";

/**
 * Token 计数器接口
 */
export interface TokenCounter {
  count(text: string): number;
  countMessages(messages: ChatMessage[]): number;
}

/**
 * 摘要生成器接口
 */
export interface Summarizer {
  summarize(messages: ChatMessage[]): Promise<string>;
}

/**
 * 上下文压缩器配置
 */
export interface ContextCompressorConfig {
  /** 最大 token 数 */
  maxTokens: number;
  /** 触发压缩的阈值 */
  compressionThreshold: number;
  /** 保留最近消息数 */
  preserveRecentMessages: number;
  /** 是否启用压缩 */
  enabled: boolean;
  /** 压缩策略 */
  strategy: "summarize" | "truncate" | "hybrid";
}

/**
 * 默认配置
 */
export const DEFAULT_COMPRESSOR_CONFIG: ContextCompressorConfig = {
  maxTokens: 128000,
  compressionThreshold: 0.8, // 80% 时触发
  preserveRecentMessages: 10,
  enabled: true,
  strategy: "hybrid",
};

/**
 * 压缩结果
 */
export interface CompressionResult {
  /** 压缩后的消息 */
  messages: ChatMessage[];
  /** 是否执行了压缩 */
  compressed: boolean;
  /** 原始 token 数 */
  originalTokens: number;
  /** 压缩后 token 数 */
  compressedTokens: number;
  /** 节省的 token 数 */
  tokensSaved: number;
  /** 压缩摘要（如果有） */
  summary?: string;
}

/**
 * 上下文管理器配置
 */
export interface ContextManagerConfig {
  /** 压缩器配置 */
  compressor: Partial<ContextCompressorConfig>;
  /** 是否启用自动管理 */
  autoManage: boolean;
  /** 检查间隔（毫秒） */
  checkInterval: number;
}

/**
 * 默认配置
 */
export const DEFAULT_CONTEXT_MANAGER_CONFIG: ContextManagerConfig = {
  compressor: DEFAULT_COMPRESSOR_CONFIG,
  autoManage: true,
  checkInterval: 1000,
};

/**
 * 简单 Token 计数器
 *
 * 使用近似算法估算 token 数
 */
export class SimpleTokenCounter implements TokenCounter {
  /**
   * 计算文本的 token 数
   */
  count(text: string): number {
    if (!text) return 0;

    // 粗略估算：
    // - 英文：约 4 字符 = 1 token
    // - 中文：约 1 字符 = 2 token
    // - 代码：约 3 字符 = 1 token
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const codeChars = (text.match(/[{}()\[\];:=<>&|!]/g) || []).length;
    const otherChars = text.length - chineseChars - codeChars;

    return Math.ceil(
      chineseChars * 2 + codeChars / 3 + otherChars / 4
    );
  }

  /**
   * 计算消息列表的总 token 数
   */
  countMessages(messages: ChatMessage[]): number {
    let total = 0;

    for (const msg of messages) {
      // 每条消息有基础开销
      total += 4; // role + formatting

      if (typeof msg.content === "string") {
        total += this.count(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            total += this.count(part.text);
          } else if (part.type === "image_url") {
            // 图片估算
            total += 85; // 低分辨率图片
          }
        }
      }
    }

    return total;
  }
}

/**
 * 上下文压缩器
 */
export class ContextCompressor {
  private config: ContextCompressorConfig;
  private tokenCounter: TokenCounter;
  private summarizer?: Summarizer;

  constructor(
    config: Partial<ContextCompressorConfig> = {},
    tokenCounter?: TokenCounter,
    summarizer?: Summarizer
  ) {
    this.config = { ...DEFAULT_COMPRESSOR_CONFIG, ...config };
    this.tokenCounter = tokenCounter ?? new SimpleTokenCounter();
    this.summarizer = summarizer;
  }

  /**
   * 检查是否需要压缩
   */
  needsCompression(messages: ChatMessage[]): boolean {
    if (!this.config.enabled) return false;

    const tokenCount = this.tokenCounter.countMessages(messages);
    const threshold = this.config.maxTokens * this.config.compressionThreshold;

    return tokenCount > threshold;
  }

  /**
   * 压缩消息列表
   */
  async compress(messages: ChatMessage[]): Promise<CompressionResult> {
    const originalTokens = this.tokenCounter.countMessages(messages);

    if (!this.needsCompression(messages)) {
      return {
        messages,
        compressed: false,
        originalTokens,
        compressedTokens: originalTokens,
        tokensSaved: 0,
      };
    }

    const preserveCount = this.config.preserveRecentMessages;
    const oldMessages = messages.slice(0, -preserveCount);
    const recentMessages = messages.slice(-preserveCount);

    let summary: string | undefined;
    let compressedOld: ChatMessage[] = [];

    switch (this.config.strategy) {
      case "summarize":
        if (this.summarizer && oldMessages.length > 0) {
          summary = await this.summarizer.summarize(oldMessages);
          compressedOld = [
            {
              role: "system",
              content: `## 历史对话摘要\n\n${summary}`,
            },
          ];
        }
        break;

      case "truncate":
        // 直接截断，只保留关键信息
        compressedOld = this.truncateMessages(oldMessages);
        break;

      case "hybrid":
      default:
        if (this.summarizer && oldMessages.length > 5) {
          summary = await this.summarizer.summarize(oldMessages.slice(0, -2));
          compressedOld = [
            {
              role: "system",
              content: `## 历史对话摘要\n\n${summary}`,
            },
            ...oldMessages.slice(-2),
          ];
        } else {
          compressedOld = this.truncateMessages(oldMessages);
        }
        break;
    }

    const compressedMessages = [...compressedOld, ...recentMessages];
    const compressedTokens = this.tokenCounter.countMessages(compressedMessages);

    return {
      messages: compressedMessages,
      compressed: true,
      originalTokens,
      compressedTokens,
      tokensSaved: originalTokens - compressedTokens,
      summary,
    };
  }

  /**
   * 截断消息（保留关键信息）
   */
  private truncateMessages(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length <= 2) return messages;

    const result: ChatMessage[] = [];
    const maxMessages = Math.min(5, Math.floor(messages.length / 2));

    // 保留第一条和最后几条
    result.push(messages[0]!);
    for (let i = messages.length - maxMessages; i < messages.length; i++) {
      const msg = messages[i];
      if (msg && !result.includes(msg)) {
        result.push(msg);
      }
    }

    return result;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ContextCompressorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): ContextCompressorConfig {
    return { ...this.config };
  }
}

/**
 * 上下文管理器
 *
 * 统一管理上下文的压缩和优化
 */
export class ContextManager {
  private config: ContextManagerConfig;
  private compressor: ContextCompressor;
  private tokenCounter: TokenCounter;

  constructor(
    config: Partial<ContextManagerConfig> = {},
    tokenCounter?: TokenCounter,
    summarizer?: Summarizer
  ) {
    this.config = { ...DEFAULT_CONTEXT_MANAGER_CONFIG, ...config };
    this.tokenCounter = tokenCounter ?? new SimpleTokenCounter();
    this.compressor = new ContextCompressor(
      this.config.compressor,
      this.tokenCounter,
      summarizer
    );
  }

  /**
   * 管理上下文
   *
   * 自动检测并压缩超出限制的上下文
   */
  async manage(messages: ChatMessage[]): Promise<CompressionResult> {
    if (!this.config.autoManage) {
      const tokens = this.tokenCounter.countMessages(messages);
      return {
        messages,
        compressed: false,
        originalTokens: tokens,
        compressedTokens: tokens,
        tokensSaved: 0,
      };
    }

    return this.compressor.compress(messages);
  }

  /**
   * 获取上下文统计
   */
  getStats(messages: ChatMessage[]): {
    messageCount: number;
    tokenCount: number;
    maxTokens: number;
    utilization: number;
    needsCompression: boolean;
  } {
    const tokenCount = this.tokenCounter.countMessages(messages);
    const maxTokens = this.config.compressor.maxTokens ?? DEFAULT_COMPRESSOR_CONFIG.maxTokens;

    return {
      messageCount: messages.length,
      tokenCount,
      maxTokens,
      utilization: tokenCount / maxTokens,
      needsCompression: this.compressor.needsCompression(messages),
    };
  }

  /**
   * 计算 token 数
   */
  countTokens(text: string): number {
    return this.tokenCounter.count(text);
  }

  /**
   * 计算消息 token 数
   */
  countMessageTokens(messages: ChatMessage[]): number {
    return this.tokenCounter.countMessages(messages);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ContextManagerConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.compressor) {
      this.compressor.updateConfig(config.compressor);
    }
  }

  /**
   * 获取配置
   */
  getConfig(): ContextManagerConfig {
    return {
      ...this.config,
      compressor: this.compressor.getConfig(),
    };
  }
}

/**
 * 创建上下文管理器实例
 */
export function createContextManager(
  config?: Partial<ContextManagerConfig>,
  tokenCounter?: TokenCounter,
  summarizer?: Summarizer
): ContextManager {
  return new ContextManager(config, tokenCounter, summarizer);
}

/**
 * 创建 Token 计数器实例
 */
export function createTokenCounter(): TokenCounter {
  return new SimpleTokenCounter();
}
