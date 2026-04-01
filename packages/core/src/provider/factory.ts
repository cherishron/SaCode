/**
 * AI Provider 工厂
 *
 * 根据配置创建对应的 Provider 实例
 */

import type { AIProvider, ProviderConfig, ProviderType } from "./types";
import { ProviderError } from "./types";
import { createOpenAIProvider } from "./openai";
import { createAnthropicProvider } from "./anthropic";

// ============================================================================
// 默认模型配置
// ============================================================================

/**
 * 各 Provider 的默认模型
 */
export const DEFAULT_MODELS: Record<ProviderType, string> = {
  openai: "gpt-4o",
  anthropic: "claude-3-5-sonnet-latest",
  deepseek: "deepseek-chat",
  moonshot: "moonshot-v1-8k",
  zhipu: "glm-4-plus",
};

// ============================================================================
// Provider 默认 baseUrl
// ============================================================================

/**
 * 各 Provider 的默认 API baseUrl
 */
export const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com/v1",
  moonshot: "https://api.moonshot.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
};

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Provider 实例
 *
 * @param config Provider 配置
 * @returns Provider 实例
 * @throws ProviderError 如果配置无效或不支持的类型
 */
export function createProvider(config: ProviderConfig): AIProvider {
  const providerType = config.type;

  // 补充默认值
  const model = config.model ?? DEFAULT_MODELS[providerType];
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URLS[providerType];

  switch (providerType) {
    case "openai":
    case "deepseek":
    case "moonshot":
    case "zhipu":
      return createOpenAIProvider({
        ...config,
        type: providerType,
        model,
        baseUrl,
      });

    case "anthropic":
      return createAnthropicProvider({
        ...config,
        type: providerType,
        model,
        baseUrl,
      });

    default:
      throw new ProviderError(
        providerType,
        "UNSUPPORTED_PROVIDER",
        `Unsupported provider type: ${providerType}`
      );
  }
}

// ============================================================================
// 从环境变量创建
// ============================================================================

/**
 * 环境变量配置
 */
export interface EnvConfig {
  /** Provider 类型 */
  AI_PROVIDER?: string;
  /** OpenAI API Key */
  OPENAI_API_KEY?: string;
  /** OpenAI 模型 */
  OPENAI_MODEL?: string;
  /** OpenAI Base URL */
  OPENAI_BASE_URL?: string;
  /** Anthropic API Key */
  ANTHROPIC_API_KEY?: string;
  /** Anthropic 模型 */
  ANTHROPIC_MODEL?: string;
  /** Anthropic Base URL */
  ANTHROPIC_BASE_URL?: string;
  /** DeepSeek API Key */
  DEEPSEEK_API_KEY?: string;
  /** DeepSeek 模型 */
  DEEPSEEK_MODEL?: string;
  /** Moonshot API Key */
  MOONSHOT_API_KEY?: string;
  /** 智谱 API Key */
  ZHIPU_API_KEY?: string;
}

/**
 * 从环境变量创建 Provider
 *
 * @param env 环境变量对象（默认尝试从 process.env 获取）
 * @returns Provider 实例
 * @throws Error 如果未提供 env 且无法访问 process.env
 */
export function createProviderFromEnv(env?: EnvConfig): AIProvider {
  // 如果未提供 env，尝试从 process.env 获取
  // 注意：Edge Runtime（Cloudflare Workers、Vercel Edge）可能不支持 process.env
  if (!env) {
    // 检测 process.env 是否可用
    if (typeof process !== "undefined" && process.env) {
      env = process.env as EnvConfig;
    } else {
      throw new ProviderError(
        "openai",
        "ENV_NOT_AVAILABLE",
        "Environment variables not available. Please pass env config explicitly for Edge Runtime environments."
      );
    }
  }

  const providerType = (env.AI_PROVIDER ?? "openai") as ProviderType;

  // 根据类型获取配置
  const config = getProviderConfigFromEnv(providerType, env);

  return createProvider(config);
}

/**
 * 从环境变量获取 Provider 配置
 */
function getProviderConfigFromEnv(type: ProviderType, env: EnvConfig): ProviderConfig {
  switch (type) {
    case "openai":
      return {
        type: "openai",
        apiKey: env.OPENAI_API_KEY ?? "",
        model: env.OPENAI_MODEL ?? DEFAULT_MODELS.openai,
        baseUrl: env.OPENAI_BASE_URL,
      };

    case "anthropic":
      return {
        type: "anthropic",
        apiKey: env.ANTHROPIC_API_KEY ?? "",
        model: env.ANTHROPIC_MODEL ?? DEFAULT_MODELS.anthropic,
        baseUrl: env.ANTHROPIC_BASE_URL,
      };

    case "deepseek":
      return {
        type: "deepseek",
        apiKey: env.DEEPSEEK_API_KEY ?? "",
        model: env.DEEPSEEK_MODEL ?? DEFAULT_MODELS.deepseek,
      };

    case "moonshot":
      return {
        type: "moonshot",
        apiKey: env.MOONSHOT_API_KEY ?? "",
        model: DEFAULT_MODELS.moonshot,
      };

    case "zhipu":
      return {
        type: "zhipu",
        apiKey: env.ZHIPU_API_KEY ?? "",
        model: DEFAULT_MODELS.zhipu,
      };

    default:
      // 默认使用 OpenAI 配置
      return {
        type: "openai",
        apiKey: env.OPENAI_API_KEY ?? "",
        model: env.OPENAI_MODEL ?? DEFAULT_MODELS.openai,
        baseUrl: env.OPENAI_BASE_URL,
      };
  }
}

// ============================================================================
// Provider 注册
// ============================================================================

/**
 * Provider 创建函数类型
 */
export type ProviderFactory = (config: ProviderConfig) => AIProvider;

/**
 * Provider 注册表
 */
const providerRegistry = new Map<ProviderType, ProviderFactory>();
providerRegistry.set("openai", (config) => createOpenAIProvider(config as Parameters<typeof createOpenAIProvider>[0]));
providerRegistry.set("deepseek", (config) => createOpenAIProvider(config as Parameters<typeof createOpenAIProvider>[0]));
providerRegistry.set("moonshot", (config) => createOpenAIProvider(config as Parameters<typeof createOpenAIProvider>[0]));
providerRegistry.set("zhipu", (config) => createOpenAIProvider(config as Parameters<typeof createOpenAIProvider>[0]));
providerRegistry.set("anthropic", (config) => createAnthropicProvider(config as Parameters<typeof createAnthropicProvider>[0]));

/**
 * 注册自定义 Provider
 *
 * @param type Provider 类型
 * @param factory 创建函数
 */
export function registerProvider(type: ProviderType, factory: ProviderFactory): void {
  providerRegistry.set(type, factory);
}

/**
 * 获取已注册的 Provider 类型列表
 */
export function getRegisteredProviderTypes(): ProviderType[] {
  return Array.from(providerRegistry.keys());
}

/**
 * 检查 Provider 类型是否已注册
 */
export function isProviderRegistered(type: ProviderType): boolean {
  return providerRegistry.has(type);
}
