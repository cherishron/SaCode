/**
 * AI 模型定价配置
 *
 * 包含主流 AI 模型的定价信息（2026 年 3 月数据）
 * 价格单位：美元/百万 Token
 */

import type { ProviderType } from "../provider/types";
import type { ModelPricing } from "./types";

// ============================================================================
// OpenAI 定价
// ============================================================================

/**
 * OpenAI 模型定价
 */
export const OPENAI_PRICING: ModelPricing[] = [
  // GPT-4.1 系列
  {
    modelId: "gpt-4.1",
    displayName: "GPT-4.1",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 8.0,
    contextWindow: 1047576,
    maxOutputTokens: 32768,
  },
  {
    modelId: "gpt-4.1-mini",
    displayName: "GPT-4.1 Mini",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 0.4,
    outputPricePerMillion: 1.6,
    contextWindow: 1047576,
    maxOutputTokens: 32768,
  },
  {
    modelId: "gpt-4.1-nano",
    displayName: "GPT-4.1 Nano",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    contextWindow: 1047576,
    maxOutputTokens: 32768,
  },
  // GPT-4o 系列
  {
    modelId: "gpt-4o",
    displayName: "GPT-4o",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
    cachedInputPricePerMillion: 1.25,
    contextWindow: 128000,
    maxOutputTokens: 16384,
  },
  {
    modelId: "gpt-4o-mini",
    displayName: "GPT-4o Mini",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    cachedInputPricePerMillion: 0.075,
    contextWindow: 128000,
    maxOutputTokens: 16384,
  },
  // GPT-4 Turbo
  {
    modelId: "gpt-4-turbo",
    displayName: "GPT-4 Turbo",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 10.0,
    outputPricePerMillion: 30.0,
    contextWindow: 128000,
    maxOutputTokens: 4096,
  },
  {
    modelId: "gpt-4",
    displayName: "GPT-4",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 30.0,
    outputPricePerMillion: 60.0,
    contextWindow: 8192,
    maxOutputTokens: 4096,
  },
  {
    modelId: "gpt-4-32k",
    displayName: "GPT-4 32K",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 60.0,
    outputPricePerMillion: 120.0,
    contextWindow: 32768,
    maxOutputTokens: 4096,
  },
  // o 系列推理模型
  {
    modelId: "o1",
    displayName: "o1",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 15.0,
    outputPricePerMillion: 60.0,
    contextWindow: 200000,
    maxOutputTokens: 100000,
  },
  {
    modelId: "o1-mini",
    displayName: "o1 Mini",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 1.1,
    outputPricePerMillion: 4.4,
    contextWindow: 128000,
    maxOutputTokens: 65536,
  },
  {
    modelId: "o1-pro",
    displayName: "o1 Pro",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 150.0,
    outputPricePerMillion: 600.0,
    contextWindow: 200000,
    maxOutputTokens: 100000,
  },
  // o3 系列
  {
    modelId: "o3-mini",
    displayName: "o3 Mini",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 1.1,
    outputPricePerMillion: 4.4,
    contextWindow: 200000,
    maxOutputTokens: 100000,
  },
  // 旧模型
  {
    modelId: "gpt-3.5-turbo",
    displayName: "GPT-3.5 Turbo",
    provider: "openai" as ProviderType,
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 1.5,
    contextWindow: 16385,
    maxOutputTokens: 4096,
  },
];

// ============================================================================
// Anthropic 定价
// ============================================================================

/**
 * Anthropic 模型定价（含 Prompt Caching）
 */
export const ANTHROPIC_PRICING: ModelPricing[] = [
  // Claude 4 系列
  {
    modelId: "claude-opus-4-20250514",
    displayName: "Claude Opus 4",
    provider: "anthropic" as ProviderType,
    inputPricePerMillion: 15.0,
    outputPricePerMillion: 75.0,
    cachedInputPricePerMillion: 1.5,
    cacheWritePricePerMillion: 18.75,
    contextWindow: 200000,
    maxOutputTokens: 32000,
  },
  {
    modelId: "claude-sonnet-4-20250514",
    displayName: "Claude Sonnet 4",
    provider: "anthropic" as ProviderType,
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cachedInputPricePerMillion: 0.3,
    cacheWritePricePerMillion: 3.75,
    contextWindow: 200000,
    maxOutputTokens: 32000,
  },
  // Claude 3.7 系列
  {
    modelId: "claude-3-7-sonnet-20250219",
    displayName: "Claude 3.7 Sonnet",
    provider: "anthropic" as ProviderType,
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cachedInputPricePerMillion: 0.3,
    cacheWritePricePerMillion: 3.75,
    contextWindow: 200000,
    maxOutputTokens: 8192,
  },
  // Claude 3.5 系列
  {
    modelId: "claude-3-5-sonnet-20241022",
    displayName: "Claude 3.5 Sonnet (v2)",
    provider: "anthropic" as ProviderType,
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cachedInputPricePerMillion: 0.3,
    cacheWritePricePerMillion: 3.75,
    contextWindow: 200000,
    maxOutputTokens: 8192,
  },
  {
    modelId: "claude-3-5-sonnet-20240620",
    displayName: "Claude 3.5 Sonnet",
    provider: "anthropic" as ProviderType,
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cachedInputPricePerMillion: 0.3,
    cacheWritePricePerMillion: 3.75,
    contextWindow: 200000,
    maxOutputTokens: 8192,
  },
  {
    modelId: "claude-3-5-haiku-20241022",
    displayName: "Claude 3.5 Haiku",
    provider: "anthropic" as ProviderType,
    inputPricePerMillion: 0.8,
    outputPricePerMillion: 4.0,
    cachedInputPricePerMillion: 0.08,
    cacheWritePricePerMillion: 1.0,
    contextWindow: 200000,
    maxOutputTokens: 8192,
  },
  // Claude 3 系列
  {
    modelId: "claude-3-opus-20240229",
    displayName: "Claude 3 Opus",
    provider: "anthropic" as ProviderType,
    inputPricePerMillion: 15.0,
    outputPricePerMillion: 75.0,
    cachedInputPricePerMillion: 1.5,
    cacheWritePricePerMillion: 18.75,
    contextWindow: 200000,
    maxOutputTokens: 4096,
  },
  {
    modelId: "claude-3-sonnet-20240229",
    displayName: "Claude 3 Sonnet",
    provider: "anthropic" as ProviderType,
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cachedInputPricePerMillion: 0.3,
    cacheWritePricePerMillion: 3.75,
    contextWindow: 200000,
    maxOutputTokens: 4096,
  },
  {
    modelId: "claude-3-haiku-20240307",
    displayName: "Claude 3 Haiku",
    provider: "anthropic" as ProviderType,
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 1.25,
    cachedInputPricePerMillion: 0.03,
    cacheWritePricePerMillion: 0.3,
    contextWindow: 200000,
    maxOutputTokens: 4096,
  },
];

// ============================================================================
// DeepSeek 定价
// ============================================================================

/**
 * DeepSeek 模型定价
 */
export const DEEPSEEK_PRICING: ModelPricing[] = [
  {
    modelId: "deepseek-chat",
    displayName: "DeepSeek Chat",
    provider: "deepseek" as ProviderType,
    inputPricePerMillion: 0.27,
    outputPricePerMillion: 1.1,
    cachedInputPricePerMillion: 0.07,
    contextWindow: 64000,
    maxOutputTokens: 4096,
  },
  {
    modelId: "deepseek-reasoner",
    displayName: "DeepSeek Reasoner",
    provider: "deepseek" as ProviderType,
    inputPricePerMillion: 0.55,
    outputPricePerMillion: 2.19,
    cachedInputPricePerMillion: 0.14,
    contextWindow: 64000,
    maxOutputTokens: 4096,
  },
];

// ============================================================================
// Moonshot 定价
// ============================================================================

/**
 * Moonshot 模型定价
 */
export const MOONSHOT_PRICING: ModelPricing[] = [
  {
    modelId: "moonshot-v1-8k",
    displayName: "Moonshot V1 8K",
    provider: "moonshot" as ProviderType,
    inputPricePerMillion: 12.0,
    outputPricePerMillion: 12.0,
    contextWindow: 8192,
    maxOutputTokens: 4096,
  },
  {
    modelId: "moonshot-v1-32k",
    displayName: "Moonshot V1 32K",
    provider: "moonshot" as ProviderType,
    inputPricePerMillion: 24.0,
    outputPricePerMillion: 24.0,
    contextWindow: 32768,
    maxOutputTokens: 4096,
  },
  {
    modelId: "moonshot-v1-128k",
    displayName: "Moonshot V1 128K",
    provider: "moonshot" as ProviderType,
    inputPricePerMillion: 60.0,
    outputPricePerMillion: 60.0,
    contextWindow: 131072,
    maxOutputTokens: 4096,
  },
];

// ============================================================================
// 智谱 定价
// ============================================================================

/**
 * 智谱模型定价
 */
export const ZHIPU_PRICING: ModelPricing[] = [
  {
    modelId: "glm-4",
    displayName: "GLM-4",
    provider: "zhipu" as ProviderType,
    inputPricePerMillion: 100.0,
    outputPricePerMillion: 100.0,
    contextWindow: 128000,
    maxOutputTokens: 4096,
  },
  {
    modelId: "glm-4-air",
    displayName: "GLM-4-Air",
    provider: "zhipu" as ProviderType,
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 1.0,
    contextWindow: 128000,
    maxOutputTokens: 4096,
  },
  {
    modelId: "glm-4-flash",
    displayName: "GLM-4-Flash",
    provider: "zhipu" as ProviderType,
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.1,
    contextWindow: 128000,
    maxOutputTokens: 4096,
  },
  {
    modelId: "glm-4-plus",
    displayName: "GLM-4-Plus",
    provider: "zhipu" as ProviderType,
    inputPricePerMillion: 50.0,
    outputPricePerMillion: 50.0,
    contextWindow: 128000,
    maxOutputTokens: 4096,
  },
];

// ============================================================================
// 统一定价映射
// ============================================================================

/**
 * 所有模型定价映射
 */
export const MODEL_PRICING_MAP: Map<string, ModelPricing> = new Map([
  ...OPENAI_PRICING.map((p) => [p.modelId, p] as const),
  ...ANTHROPIC_PRICING.map((p) => [p.modelId, p] as const),
  ...DEEPSEEK_PRICING.map((p) => [p.modelId, p] as const),
  ...MOONSHOT_PRICING.map((p) => [p.modelId, p] as const),
  ...ZHIPU_PRICING.map((p) => [p.modelId, p] as const),
]);

/**
 * 模型别名映射（常见别名 -> 标准模型 ID）
 */
export const MODEL_ALIASES: Map<string, string> = new Map([
  // OpenAI 别名
  ["gpt4", "gpt-4"],
  ["gpt4o", "gpt-4o"],
  ["gpt-4o-2024-05-13", "gpt-4o"],
  ["gpt-4o-2024-08-06", "gpt-4o"],
  ["gpt-4o-2024-11-20", "gpt-4o"],
  ["gpt-4o-mini-2024-07-18", "gpt-4o-mini"],
  ["gpt-4-turbo-preview", "gpt-4-turbo"],
  ["gpt-4-0125-preview", "gpt-4-turbo"],
  ["gpt-4-1106-preview", "gpt-4-turbo"],
  ["gpt-3.5-turbo-0125", "gpt-3.5-turbo"],
  ["gpt-3.5-turbo-1106", "gpt-3.5-turbo"],
  ["o1-preview", "o1"],
  ["o1-2024-12-17", "o1"],
  
  // Anthropic 别名
  ["claude-opus-4", "claude-opus-4-20250514"],
  ["claude-sonnet-4", "claude-sonnet-4-20250514"],
  ["claude-3.7-sonnet", "claude-3-7-sonnet-20250219"],
  ["claude-3.5-sonnet", "claude-3-5-sonnet-20241022"],
  ["claude-3.5-haiku", "claude-3-5-haiku-20241022"],
  ["claude-3-opus", "claude-3-opus-20240229"],
  ["claude-3-sonnet", "claude-3-sonnet-20240229"],
  ["claude-3-haiku", "claude-3-haiku-20240307"],
  
  // DeepSeek 别名
  ["deepseek-v3", "deepseek-chat"],
  ["deepseek-r1", "deepseek-reasoner"],
  
  // 智谱别名
  ["glm4", "glm-4"],
]);

/**
 * 获取模型定价
 *
 * @param modelId 模型 ID 或别名
 * @returns 模型定价配置，如果未找到返回 undefined
 */
export function getModelPricing(modelId: string): ModelPricing | undefined {
  // 直接查找
  const direct = MODEL_PRICING_MAP.get(modelId);
  if (direct) {
    return direct;
  }

  // 尝试别名
  const alias = MODEL_ALIASES.get(modelId);
  if (alias) {
    return MODEL_PRICING_MAP.get(alias);
  }

  // 尝试模糊匹配（前缀匹配）
  const normalizedId = modelId.toLowerCase();
  for (const [id, pricing] of MODEL_PRICING_MAP) {
    if (id.toLowerCase().startsWith(normalizedId) || normalizedId.startsWith(id.toLowerCase())) {
      return pricing;
    }
  }

  return undefined;
}

/**
 * 获取默认模型定价（用于未知模型）
 */
export function getDefaultPricing(modelId: string, provider: ProviderType): ModelPricing {
  return {
    modelId,
    displayName: modelId,
    provider,
    inputPricePerMillion: 1.0, // 默认 $1/百万 Token
    outputPricePerMillion: 3.0, // 默认 $3/百万 Token
    contextWindow: 128000,
  };
}
