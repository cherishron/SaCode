/**
 * CodingPlan 厂商预设注册
 * 内置所有已知厂商的端点和模型信息
 */

import type { ProviderPreset, CodingPlanProvider } from "./types.js";

const PROVIDER_LIST: ProviderPreset[] = [
  {
    id: "aliyun",
    name: "阿里云百炼",
    openaiBaseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    anthropicBaseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    protocol: "both",
    models: ["qwen3.5-plus", "qwen3-max", "qwen3-coder", "glm-5", "kimi-k2.5", "minimax-m2.5", "deepseek-v3.2", "glm-4.7"],
    keyPrefix: "sk-sp-",
    docs: "https://help.aliyun.com/zh/model-studio/coding-plan",
  },
  {
    id: "volcengine",
    name: "火山引擎方舟",
    openaiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3/coding",
    anthropicBaseUrl: "https://ark.cn-beijing.volces.com/api/coding",
    protocol: "both",
    models: ["doubao-seed-code", "deepseek-v3.2", "kimi-k2.5", "glm-5", "minimax-m2.5"],
    docs: "https://www.volcengine.com/docs/82379/",
  },
  {
    id: "baidu",
    name: "百度千帆",
    openaiBaseUrl: "https://qianfan.baidubce.com/v2/coding",
    anthropicBaseUrl: "https://qianfan.baidubce.com/anthropic/coding",
    protocol: "both",
    models: ["ernie-4.5-turbo", "deepseek-v3.2", "glm-5", "kimi-k2.5", "minimax-m2.5"],
    docs: "https://cloud.baidu.com/doc/qianfan/s/imlg0beiu",
  },
  {
    id: "tencent",
    name: "腾讯云",
    protocol: "both",
    models: ["hunyuan-2.0", "hunyuan-think", "glm-5", "kimi-k2.5", "minimax-m2.5", "deepseek-v3.2"],
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    protocol: "openai",
    models: ["glm-5", "glm-4.7", "glm-4.6"],
    docs: "https://open.bigmodel.cn/",
  },
  {
    id: "minimax",
    name: "MiniMax",
    protocol: "openai",
    models: ["minimax-m2.5", "minimax-m2.5-highspeed"],
  },
  {
    id: "ucloud",
    name: "优云智算",
    openaiBaseUrl: "https://api.modelverse.cn/v1",
    anthropicBaseUrl: "https://api.modelverse.cn",
    protocol: "both",
    models: ["glm-5", "kimi-k2.5", "minimax-m2.5", "deepseek-v3.2", "qwen3-max", "claude-3.5-sonnet"],
  },
  {
    id: "kimi",
    name: "月之暗面 Kimi",
    protocol: "openai",
    models: ["kimi-k2.5"],
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
