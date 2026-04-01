/**
 * 上下文管理模块入口
 *
 * 提供多层级上下文加载和智能管理功能
 */

// 上下文加载器
export {
  ContextLoader,
  createContextLoader,
  DEFAULT_CONTEXT_LOADER_CONFIG,
} from "./loader";
export type {
  ContextLevel,
  ContextFile,
  ContextLoadResult,
  ContextLoaderConfig,
  ContextLoaderEvents,
} from "./loader";

// 上下文管理器
export {
  ContextManager,
  ContextCompressor,
  SimpleTokenCounter,
  createContextManager,
  createTokenCounter,
  DEFAULT_COMPRESSOR_CONFIG,
  DEFAULT_CONTEXT_MANAGER_CONFIG,
} from "./manager";
export type {
  TokenCounter,
  Summarizer,
  ContextCompressorConfig,
  CompressionResult,
  ContextManagerConfig,
} from "./manager";