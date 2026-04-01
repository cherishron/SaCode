/**
 * AI Provider 模块
 *
 * 统一的 AI 服务提供商抽象层，支持 OpenAI、Anthropic 等多种后端
 */

// 类型定义
export type {
  AIProvider,
  AnthropicProviderConfig,
  BaseProviderConfig,
  ChatCompletionOptions,
  ChatMessage,
  ChatMessageContent,
  MCPToolConverter,
  OpenAIProviderConfig,
  ProviderConfig,
  ProviderEvents,
  ProviderType,
  StreamChunk,
  StreamChunkType,
  ToolCall,
  ToolCallResult,
  ToolDefinition,
} from "./types";

export {
  APIKeyError,
  defaultMCPToolConverter,
  ModelNotAvailableError,
  PROVIDER_TYPES,
  ProviderError,
  RateLimitError,
  streamChunkToMessage,
} from "./types";

// 基类
export { BaseProvider, DEFAULT_RETRY_CONFIG } from "./base";
export type { RetryConfig } from "./base";

// OpenAI Provider
export { createOpenAIProvider, OpenAIProvider } from "./openai";

// Anthropic Provider
export { createAnthropicProvider, AnthropicProvider } from "./anthropic";

// 工厂
export {
  createProvider,
  createProviderFromEnv,
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  getRegisteredProviderTypes,
  isProviderRegistered,
  registerProvider,
} from "./factory";
export type { EnvConfig, ProviderFactory } from "./factory";
