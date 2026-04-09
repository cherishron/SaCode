/**
 * AI Provider 抽象层类型定义
 *
 * 支持多种 AI 服务提供商（OpenAI、Anthropic 等）的统一接口
 */

import type { Message } from "../types";

// ============================================================================
// Provider 类型枚举
// ============================================================================

/**
 * 支持的 AI Provider 类型
 */
export type ProviderType = "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu" | "codingplan";

/**
 * Provider 类型配置映射
 */
export const PROVIDER_TYPES = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  DEEPSEEK: "deepseek",
  MOONSHOT: "moonshot",
  ZHIPU: "zhipu",
  CODINGPLAN: "codingplan",
} as const;

// ============================================================================
// Provider 配置接口
// ============================================================================

/**
 * 基础 Provider 配置
 */
export interface BaseProviderConfig {
  /** Provider 类型 */
  type: ProviderType;
  /** API 密钥 */
  apiKey: string;
  /** API 基础 URL（可选，用于代理或兼容 API） */
  baseUrl?: string | undefined;
  /** 默认模型 */
  model: string;
  /** 请求超时时间（毫秒） */
  timeout?: number | undefined;
  /** 最大重试次数 */
  maxRetries?: number | undefined;
  /** 调试模式 */
  debug?: boolean | undefined;
}

/**
 * OpenAI Provider 配置
 */
export interface OpenAIProviderConfig extends BaseProviderConfig {
  type: "openai" | "deepseek" | "moonshot" | "zhipu" | "codingplan";
  /** 组织 ID */
  organization?: string | undefined;
  /** 项目 ID */
  project?: string | undefined;
}

/**
 * Anthropic Provider 配置
 */
export interface AnthropicProviderConfig extends BaseProviderConfig {
  type: "anthropic";
  /** Anthropic API 版本 */
  apiVersion?: string | undefined;
}

/**
 * Provider 配置联合类型
 */
export type ProviderConfig = OpenAIProviderConfig | AnthropicProviderConfig;

// ============================================================================
// 聊天消息格式
// ============================================================================

/**
 * 聊天消息内容
 */
export interface ChatMessageContent {
  /** 文本内容 */
  text: string;
  /** 内容类型 */
  type: "text" | "image" | "audio" | "video";
}

/**
 * 聊天消息
 */
export interface ChatMessage {
  /** 角色：system | user | assistant | tool */
  role: "system" | "user" | "assistant" | "tool";
  /** 消息内容 */
  content: string | ChatMessageContent[] | null;
  /** 名称（可选） */
  name?: string | undefined;
  /** 工具调用 ID（tool 角色时必需） */
  tool_call_id?: string | undefined;
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  /** 工具类型 */
  type: "function";
  /** 函数定义 */
  function: {
    /** 函数名称 */
    name: string;
    /** 函数描述 */
    description: string;
    /** 参数 JSON Schema */
    parameters: Record<string, unknown>;
  };
}

/**
 * 工具调用
 */
export interface ToolCall {
  /** 调用 ID */
  id: string;
  /** 工具类型 */
  type: "function";
  /** 函数调用 */
  function: {
    /** 函数名称 */
    name: string;
    /** 函数参数（JSON 字符串） */
    arguments: string;
  };
}

/**
 * 工具调用结果
 */
export interface ToolCallResult {
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  name: string;
  /** 执行结果 */
  content: string;
  /** 是否成功 */
  success: boolean;
}

// ============================================================================
// 聊天选项
// ============================================================================

/**
 * 聊天完成选项
 */
export interface ChatCompletionOptions {
  /** 消息历史 */
  messages: ChatMessage[];
  /** 系统提示词 */
  systemPrompt?: string | undefined;
  /** 工具定义 */
  tools?: ToolDefinition[] | undefined;
  /** 温度参数 */
  temperature?: number | undefined;
  /** 最大 Token 数 */
  maxTokens?: number | undefined;
  /** Top P 采样 */
  topP?: number | undefined;
  /** 停止序列 */
  stopSequences?: string[] | undefined;
  /** 会话 ID（用于追踪） */
  sessionId?: string | undefined;
}

// ============================================================================
// 流式响应类型
// ============================================================================

/**
 * 流式响应块类型
 */
export type StreamChunkType =
  | "text_delta"      // 文本增量
  | "tool_call"       // 工具调用
  | "tool_result"     // 工具结果
  | "error"           // 错误
  | "done";           // 完成

/**
 * Token 使用量（在流式响应中）
 */
export interface StreamUsage {
  /** 输入 Token 数量 */
  inputTokens: number;
  /** 输出 Token 数量 */
  outputTokens: number;
  /** 缓存读取的 Token（如果有 Prompt Caching） */
  cachedInputTokens?: number | undefined;
  /** 缓存写入的 Token（如果有 Prompt Caching） */
  cacheWriteTokens?: number | undefined;
}

/**
 * 流式响应块
 */
export interface StreamChunk {
  /** 块类型 */
  type: StreamChunkType;
  /** 文本增量 */
  text?: string | undefined;
  /** 工具调用 */
  toolCall?: ToolCall | undefined;
  /** 工具调用 ID（用于结果） */
  toolCallId?: string | undefined;
  /** 工具名称 */
  toolName?: string | undefined;
  /** 工具结果 */
  toolResult?: string | undefined;
  /** 错误信息 */
  error?: {
    code: string;
    message: string;
  } | undefined;
  /** 停止原因 */
  stopReason?: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "error" | undefined;
  /** Token 使用量（在 done 类型中返回） */
  usage?: StreamUsage | undefined;
  /** 原始响应（调试用） */
  raw?: unknown;
}

// ============================================================================
// Provider 接口
// ============================================================================

/**
 * AI Provider 抽象接口
 *
 * 定义所有 AI 服务提供商必须实现的方法
 */
export interface AIProvider {
  /** Provider 类型 */
  readonly type: ProviderType;

  /** 当前使用的模型 */
  readonly model: string;

  /** 是否已初始化 */
  readonly isInitialized: boolean;

  /**
   * 初始化 Provider
   */
  initialize(): Promise<void>;

  /**
   * 流式聊天完成
   *
   * @param options 聊天选项
   * @returns 流式响应块生成器
   */
  chat(options: ChatCompletionOptions): AsyncGenerator<StreamChunk>;

  /**
   * 执行工具调用
   *
   * @param toolCall 工具调用
   * @returns 工具调用结果
   */
  executeToolCall(toolCall: ToolCall): Promise<ToolCallResult>;

  /**
   * 注册工具
   *
   * @param tool 工具定义
   * @param handler 工具处理函数
   */
  registerTool(
    tool: ToolDefinition,
    handler: (args: Record<string, unknown>) => Promise<string>
  ): void;

  /**
   * 销毁 Provider，释放资源
   */
  destroy(): Promise<void>;
}

// ============================================================================
// Provider 事件
// ============================================================================

/**
 * Provider 事件类型
 */
export interface ProviderEvents {
  /** 初始化完成 */
  initialized: () => void;
  /** 错误发生 */
  error: (error: Error) => void;
  /** 工具调用开始 */
  tool_call_start: (toolCall: ToolCall) => void;
  /** 工具调用结束 */
  tool_call_end: (result: ToolCallResult) => void;
  /** 响应完成 */
  response_complete: (stopReason: string) => void;
}

// ============================================================================
// 错误类型
// ============================================================================

/**
 * Provider 错误
 */
export class ProviderError extends Error {
  override name = "ProviderError";
  public readonly code: string;
  public readonly provider: ProviderType;

  constructor(provider: ProviderType, code: string, message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.provider = provider;
    this.code = code;
  }
}

/**
 * API 密钥错误
 */
export class APIKeyError extends ProviderError {
  override name = "APIKeyError";

  constructor(provider: ProviderType, message = "API key is missing or invalid") {
    super(provider, "API_KEY_ERROR", message);
  }
}

/**
 * 速率限制错误
 */
export class RateLimitError extends ProviderError {
  override name = "RateLimitError";
  public readonly retryAfter?: number | undefined;

  constructor(provider: ProviderType, retryAfter?: number) {
    super(provider, "RATE_LIMIT_ERROR", "Rate limit exceeded");
    this.retryAfter = retryAfter;
  }
}

/**
 * 模型不可用错误
 */
export class ModelNotAvailableError extends ProviderError {
  override name = "ModelNotAvailableError";

  constructor(provider: ProviderType, model: string) {
    super(provider, "MODEL_NOT_AVAILABLE", `Model "${model}" is not available`);
  }
}

// ============================================================================
// 工具转换
// ============================================================================

/**
 * MCP 工具转换为 Provider 工具
 */
export interface MCPToolConverter {
  /**
   * 将 MCP 工具定义转换为 Provider 工具定义
   */
  convert(mcpTool: {
    name: string;
    description?: string | undefined;
    inputSchema: Record<string, unknown>;
  }): ToolDefinition;
}

/**
 * 默认 MCP 工具转换器
 */
export const defaultMCPToolConverter: MCPToolConverter = {
  convert(mcpTool): ToolDefinition {
    return {
      type: "function",
      function: {
        name: mcpTool.name,
        description: mcpTool.description ?? `Tool: ${mcpTool.name}`,
        parameters: mcpTool.inputSchema,
      },
    };
  },
};

// ============================================================================
// 消息转换
// ============================================================================

/**
 * 将 Provider 流式响应转换为 SACODE Message
 */
export function streamChunkToMessage(
  chunk: StreamChunk,
  sessionId?: string
): Message | null {
  const baseId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const timestamp = new Date();

  switch (chunk.type) {
    case "text_delta":
      return {
        id: baseId,
        role: "assistant",
        timestamp,
        channelId: sessionId,
        chunk: {
          text: chunk.text ?? "",
          isComplete: chunk.stopReason !== undefined,
        },
        agentInfo: undefined,
      };

    case "tool_call":
      return {
        id: baseId,
        role: "tool",
        timestamp,
        channelId: sessionId,
        toolName: chunk.toolCall?.function.name ?? "unknown",
        status: "running",
        label: undefined,
        agentInfo: undefined,
      };

    case "tool_result":
      return {
        id: baseId,
        role: "tool",
        timestamp,
        channelId: sessionId,
        toolName: chunk.toolName ?? "unknown",
        status: "success",
        label: undefined,
        agentInfo: undefined,
      };

    case "error":
      return {
        id: baseId,
        role: "system",
        timestamp,
        channelId: sessionId,
        code: chunk.error?.code ?? "UNKNOWN_ERROR",
        message: chunk.error?.message ?? "An unknown error occurred",
      };

    case "done":
      return {
        id: baseId,
        role: "system",
        timestamp,
        channelId: sessionId,
        stopReason: chunk.stopReason ?? "end_turn",
      };

    default:
      return null;
  }
}
