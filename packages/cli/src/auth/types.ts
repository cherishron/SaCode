/**
 * CodingPlan 多厂商认证类型定义
 */

export type CodingPlanProvider =
  | "mimo"
  | "longcat"
  | "volcark"
  | "custom";

export interface ProviderPreset {
  id: CodingPlanProvider;
  name: string;
  openaiBaseUrl?: string;
  anthropicBaseUrl?: string;
  protocol: "openai" | "anthropic" | "both";
  models: string[];
  keyPrefix?: string;
  docs?: string;
}

export interface CodingPlanAccount {
  id: string;
  alias: string;
  provider: CodingPlanProvider;
  apiKey: string;
  baseUrl: string;
  protocol: "openai" | "anthropic";
  defaultModel?: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt?: string;
  metadata?: {
    region?: string;
    planTier?: "lite" | "pro";
  };
}

export interface CodingPlanConfig {
  accounts: CodingPlanAccount[];
  activeAccountId: string;
  globalDefaults: {
    maxTokens: number;
    temperature: number;
    preferredProtocol: "openai" | "anthropic";
  };
}

export interface CodingPlanError {
  code: string;
  message: string;
  suggestion: string;
}
