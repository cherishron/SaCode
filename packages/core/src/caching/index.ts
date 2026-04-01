/**
 * Caching 模块入口
 *
 * 提供 Prompt Caching 和其他缓存功能
 */

export {
  PromptCachingManager,
  createPromptCachingManager,
  DEFAULT_PROMPT_CACHING_CONFIG,
  isCacheableMessage,
  estimateTokens,
} from "./prompt-caching";

export type {
  CacheControl,
  CachedMessage,
  CachedToolDefinition,
  CacheStrategy,
  PromptCachingConfig,
  CacheStats,
} from "./prompt-caching";
