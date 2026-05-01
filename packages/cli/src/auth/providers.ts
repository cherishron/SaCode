/**
 * CodingPlan 厂商预设注册
 * 内置所有已知厂商的端点和模型信息
 */

import type { ProviderPreset, CodingPlanProvider } from "./types.js";

const PROVIDER_LIST: ProviderPreset[] = [
  {
    id: "mimo",
    name: "MiMo Token Plan",
    openaiBaseUrl: "https://api.mimo.ai/v1",
    protocol: "openai",
    models: ["mimo-token-plan", "mimo-pro", "mimo-lite"],
    docs: "https://docs.mimo.ai/",
  },
  {
    id: "longcat",
    name: "LongCat",
    openaiBaseUrl: "https://api.longcat.ai/v1",
    protocol: "openai",
    models: ["LongCat-Flash-Lite", "LongCat-Flash-Chat", "LongCat-Flash-Thinking-2601", "LongCat-Flash-Omni-2603"],
    docs: "https://docs.longcat.ai/",
  },
  {
    id: "volcark",
    name: "火山方舟",
    openaiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    protocol: "openai",
    models: ["doubao-seed-code", "doubao-pro", "doubao-lite", "deepseek-v3.2", "glm-5"],
    docs: "https://www.volcengine.com/docs/82379/",
  },
  {
    id: "custom",
    name: "自定义 API 服务",
    protocol: "both",
    models: ["自定义模型"],
    docs: "支持任何兼容 OpenAI 或 Anthropic 协议的 API 服务",
  },
];

export const PROVIDER_PRESETS: Map<CodingPlanProvider, ProviderPreset> = new Map(
  PROVIDER_LIST.map((p) => [p.id, p])
);

/**
 * 获取厂商预设
 */
export function getProviderPreset(provider: CodingPlanProvider): ProviderPreset | undefined {
  return PROVIDER_PRESETS.get(provider);
}

/**
 * 列出所有厂商
 */
export function listProviders(): ProviderPreset[] {
  return PROVIDER_LIST;
}

/**
 * 根据协议获取 base URL
 */
export function getBaseUrl(
  provider: ProviderPreset,
  protocol: "openai" | "anthropic"
): string | undefined {
  return protocol === "anthropic" ? provider.anthropicBaseUrl : provider.openaiBaseUrl;
}
