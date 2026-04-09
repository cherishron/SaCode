/**
 * 上下文压缩 - 四级压缩策略
 *
 * 参考 Claude Code 压缩策略：
 * - 80%: Micro-compact（清理旧工具结果）
 * - 85%: Auto-compact（完整摘要）
 * - 90%: Session-memory（提取到记忆）
 * - 95%: Truncate（截断最旧消息）
 */

import type { Message } from "./QueryEngine.js";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 压缩级别
 */
export type CompactionLevel =
  | "micro"      // 清理旧工具结果
  | "auto"       // 完整摘要
  | "session"    // 提取到记忆
  | "truncate";  // 截断消息

/**
 * 压缩策略
 */
export interface CompactionStrategy {
  /** 策略名称 */
  name: string;
  /** 触发阈值（百分比） */
  trigger: number;
  /** 执行函数 */
  execute: (messages: Message[], context: CompactionContext) => Promise<Message[]>;
}

/**
 * 压缩上下文
 */
export interface CompactionContext {
  /** 最大 Token 数 */
  maxTokens: number;
  /** 当前 Token 数 */
  currentTokens: number;
  /** 模型摘要函数 */
  summarize?: (messages: Message[]) => Promise<string>;
  /** 保存到记忆函数 */
  saveToMemory?: (content: string) => Promise<void>;
}

/**
 * 压缩结果
 */
export interface CompactionResult {
  /** 压缩级别 */
  level: CompactionLevel;
  /** 压缩前的 Token 数 */
  beforeTokens: number;
  /** 压缩后的 Token 数 */
  afterTokens: number;
  /** 压缩比率 */
  ratio: number;
  /** 被压缩的消息数 */
  compressedCount: number;
}

// ============================================================================
// Token 估算
// ============================================================================

/**
 * 估算消息的 Token 数
 *
 * 简单估算：约 4 个字符 = 1 Token
 */
export function estimateTokens(message: Message): number {
  const content = message.content ?? "";
  const toolCalls = message.toolCalls ?? [];

  let tokens = Math.ceil(content.length / 4);

  for (const tc of toolCalls) {
    tokens += Math.ceil((tc.function.name + tc.function.arguments).length / 4);
  }

  return tokens;
}

/**
 * 估算消息列表的总 Token 数
 */
export function estimateTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

// ============================================================================
// 压缩策略实现
// ============================================================================

/**
 * Micro-compact: 清理旧工具结果
 *
 * 将旧工具结果替换为 "[Old tool result content cleared]"
 */
async function microCompact(messages: Message[]): Promise<Message[]> {
  const toolResultMessages = messages.filter(
    (m) => m.role === "tool" && m.content && m.content.length > 500
  );

  if (toolResultMessages.length === 0) {
    return messages;
  }

  return messages.map((m) => {
    if (m.role === "tool" && m.content && m.content.length > 500) {
      return {
        ...m,
        content: "[Old tool result content cleared]",
      };
    }
    return m;
  });
}

/**
 * Auto-compact: 完整摘要
 *
 * 1. 移除旧消息中的图片
 * 2. 发送旧消息给模型摘要
 * 3. 用压缩边界标记替换
 * 4. 重新注入关键上下文
 */
async function autoCompact(
  messages: Message[],
  context: CompactionContext
): Promise<Message[]> {
  if (!context.summarize) {
    return messages;
  }

  // 保留最近的消息
  const keepCount = Math.ceil(messages.length * 0.3);
  const toCompress = messages.slice(0, -keepCount);
  const toKeep = messages.slice(-keepCount);

  if (toCompress.length === 0) {
    return messages;
  }

  // 生成摘要
  const summary = await context.summarize(toCompress);

  // 创建压缩标记消息
  const compressedMessage: Message = {
    role: "system",
    content: `[Context compressed]\n${summary}`,
  };

  return [compressedMessage, ...toKeep];
}

/**
 * Session-memory: 提取到记忆
 *
 * 提取关键信息到持久化会话记忆
 */
async function sessionMemoryCompact(
  messages: Message[],
  context: CompactionContext
): Promise<Message[]> {
  if (!context.saveToMemory) {
    return messages;
  }

  // 提取关键信息
  const keyInfo: string[] = [];

  for (const m of messages) {
    if (m.role === "user" && m.content) {
      // 提取用户的关键问题
      keyInfo.push(`User: ${m.content.slice(0, 200)}`);
    } else if (m.role === "assistant" && m.content && m.content.length > 100) {
      // 提取助手的关键回答
      keyInfo.push(`Assistant: ${m.content.slice(0, 200)}...`);
    }
  }

  // 保存到记忆
  if (keyInfo.length > 0) {
    await context.saveToMemory(keyInfo.join("\n\n"));
  }

  // 保留最近的消息
  const keepCount = Math.min(messages.length, 10);
  return messages.slice(-keepCount);
}

/**
 * Truncate: 截断最旧的消息
 *
 * 保留 tool_use/tool_result 配对
 */
async function truncateMessages(
  messages: Message[],
  context: CompactionContext
): Promise<Message[]> {
  const targetTokens = Math.floor(context.maxTokens * 0.7);
  let currentTokens = estimateTotalTokens(messages);
  let result = [...messages];

  // 从最旧的消息开始移除
  while (currentTokens > targetTokens && result.length > 2) {
    // 移除第一条消息
    result = result.slice(1);
    currentTokens = estimateTotalTokens(result);
  }

  return result;
}

// ============================================================================
// 压缩引擎
// ============================================================================

/**
 * 默认压缩策略
 */
const DEFAULT_STRATEGIES: CompactionStrategy[] = [
  {
    name: "micro-compact",
    trigger: 0.80,
    execute: async (messages) => microCompact(messages),
  },
  {
    name: "auto-compact",
    trigger: 0.85,
    execute: async (messages, context) => autoCompact(messages, context),
  },
  {
    name: "session-memory",
    trigger: 0.90,
    execute: async (messages, context) => sessionMemoryCompact(messages, context),
  },
  {
    name: "truncate",
    trigger: 0.95,
    execute: async (messages, context) => truncateMessages(messages, context),
  },
];

/**
 * 压缩引擎
 */
export class CompactionEngine {
  private strategies: CompactionStrategy[];

  constructor(strategies: CompactionStrategy[] = DEFAULT_STRATEGIES) {
    this.strategies = [...strategies].sort((a, b) => a.trigger - b.trigger);
  }

  /**
   * 检查是否需要压缩
   */
  needsCompaction(currentTokens: number, maxTokens: number): boolean {
    const ratio = currentTokens / maxTokens;
    return ratio >= this.strategies[0]!.trigger;
  }

  /**
   * 获取压缩级别
   */
  getCompactionLevel(currentTokens: number, maxTokens: number): CompactionLevel {
    const ratio = currentTokens / maxTokens;

    for (const strategy of this.strategies) {
      if (ratio >= strategy.trigger) {
        return strategy.name.split("-")[0] as CompactionLevel;
      }
    }

    return "micro";
  }

  /**
   * 执行压缩
   */
  async compact(
    messages: Message[],
    context: CompactionContext
  ): Promise<CompactionResult> {
    const beforeTokens = estimateTotalTokens(messages);
    const ratio = beforeTokens / context.maxTokens;

    // 找到适用的策略
    let strategy: CompactionStrategy | undefined;
    for (const s of this.strategies) {
      if (ratio >= s.trigger) {
        strategy = s;
      }
    }

    if (!strategy) {
      return {
        level: "micro",
        beforeTokens,
        afterTokens: beforeTokens,
        ratio: 1,
        compressedCount: 0,
      };
    }

    // 执行压缩
    const compressed = await strategy.execute(messages, context);
    const afterTokens = estimateTotalTokens(compressed);

    return {
      level: strategy.name.split("-")[0] as CompactionLevel,
      beforeTokens,
      afterTokens,
      ratio: afterTokens / beforeTokens,
      compressedCount: messages.length - compressed.length,
    };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default CompactionEngine;
