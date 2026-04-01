/**
 * AI Provider 基类实现
 *
 * 提供通用的重试逻辑、错误处理和工具管理
 */

import EventEmitter from "eventemitter3";
import type {
  AIProvider,
  BaseProviderConfig,
  ChatCompletionOptions,
  ProviderEvents,
  ProviderType,
  StreamChunk,
  ToolCall,
  ToolCallResult,
  ToolDefinition,
} from "./types";
import { ProviderError, RateLimitError } from "./types";

// ============================================================================
// 重试配置
// ============================================================================

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟（毫秒） */
  initialDelay: number;
  /** 最大延迟（毫秒） */
  maxDelay: number;
  /** 退避因子 */
  backoffFactor: number;
  /** 可重试的错误码 */
  retryableErrors: string[];
}

/**
 * 默认重试配置
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  retryableErrors: [
    "RATE_LIMIT_ERROR",
    "TIMEOUT_ERROR",
    "SERVICE_UNAVAILABLE",
    "INTERNAL_ERROR",
    "CONNECTION_ERROR",
  ],
};

// ============================================================================
// 基类实现
// ============================================================================

/**
 * AI Provider 基类
 *
 * 实现通用功能：
 * - 重试逻辑（指数退避）
 * - 错误处理
 * - 工具注册和管理
 * - 事件发射
 */
export abstract class BaseProvider extends EventEmitter<ProviderEvents> implements AIProvider {
  abstract readonly type: ProviderType;

  protected config: BaseProviderConfig;
  protected retryConfig: RetryConfig;
  protected tools: Map<string, { definition: ToolDefinition; handler: (args: Record<string, unknown>) => Promise<string> }>;
  protected _isInitialized = false;

  constructor(config: BaseProviderConfig) {
    super();
    this.config = config;
    this.retryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries: config.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
    };
    this.tools = new Map();
  }

  get model(): string {
    return this.config.model;
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * 初始化 Provider
   */
  abstract initialize(): Promise<void>;

  /**
   * 流式聊天完成
   */
  abstract chat(options: ChatCompletionOptions): AsyncGenerator<StreamChunk>;

  /**
   * 销毁 Provider
   */
  async destroy(): Promise<void> {
    this.tools.clear();
    this._isInitialized = false;
  }

  /**
   * 注册工具
   */
  registerTool(
    tool: ToolDefinition,
    handler: (args: Record<string, unknown>) => Promise<string>
  ): void {
    const name = tool.function.name;
    this.tools.set(name, { definition: tool, handler });
  }

  /**
   * 执行工具调用
   */
  async executeToolCall(toolCall: ToolCall): Promise<ToolCallResult> {
    const name = toolCall.function.name;
    const toolEntry = this.tools.get(name);

    if (!toolEntry) {
      return {
        toolCallId: toolCall.id,
        name,
        content: `Tool "${name}" not found`,
        success: false,
      };
    }

    try {
      this.emit("tool_call_start", toolCall);

      // 解析参数
      const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      const result = await toolEntry.handler(args);

      const toolResult: ToolCallResult = {
        toolCallId: toolCall.id,
        name,
        content: result,
        success: true,
      };

      this.emit("tool_call_end", toolResult);
      return toolResult;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const toolResult: ToolCallResult = {
        toolCallId: toolCall.id,
        name,
        content: `Tool execution error: ${err.message}`,
        success: false,
      };

      this.emit("tool_call_end", toolResult);
      return toolResult;
    }
  }

  /**
   * 获取所有已注册的工具定义
   */
  protected getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((entry) => entry.definition);
  }

  /**
   * 带重试的执行
   */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = this.retryConfig.initialDelay;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 检查是否可重试
        if (!this.isRetryableError(lastError)) {
          throw lastError;
        }

        // 最后一次尝试不再等待
        if (attempt === this.retryConfig.maxRetries) {
          break;
        }

        // 速率限制错误使用 Retry-After
        if (lastError instanceof RateLimitError && lastError.retryAfter) {
          delay = lastError.retryAfter * 1000;
        }

        if (this.config.debug) {
          console.warn(
            `[${this.type}] ${operationName} failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}), retrying in ${delay}ms:`,
            lastError.message
          );
        }

        await this.sleep(delay);
        delay = Math.min(delay * this.retryConfig.backoffFactor, this.retryConfig.maxDelay);
      }
    }

    throw lastError ?? new Error("Unexpected error in retry logic");
  }

  /**
   * 检查错误是否可重试
   */
  protected isRetryableError(error: Error): boolean {
    // ProviderError 检查
    if (error instanceof ProviderError) {
      return this.retryConfig.retryableErrors.includes(error.code);
    }

    // 网络错误检查（ECONNRESET, ETIMEDOUT, ENOTFOUND 等）
    const networkErrorCodes = [
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "ECONNREFUSED",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "EPIPE",
      "EAI_AGAIN",
    ];

    const errorCode = (error as Error & { code?: string }).code;
    if (errorCode && networkErrorCodes.includes(errorCode)) {
      return true;
    }

    // Fetch API 错误（TypeError: fetch failed）
    if (error.name === "TypeError" && error.message.includes("fetch")) {
      return true;
    }

    return false;
  }

  /**
   * 延迟函数
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 发射错误事件
   */
  protected emitError(error: Error): void {
    this.emit("error", error);
  }

  /**
   * 发射响应完成事件
   */
  protected emitComplete(stopReason: string): void {
    this.emit("response_complete", stopReason);
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 计算退避延迟
 */
export function calculateBackoff(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffFactor: number
): number {
  const delay = initialDelay * Math.pow(backoffFactor, attempt);
  return Math.min(delay, maxDelay);
}

/**
 * 判断是否需要重试
 */
export function shouldRetry(error: unknown, retryableErrors: string[]): boolean {
  if (error instanceof ProviderError) {
    return retryableErrors.includes(error.code);
  }
  return false;
}
