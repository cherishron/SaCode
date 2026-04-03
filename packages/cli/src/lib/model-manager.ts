/**
 * 模型管理器
 * 
 * 管理各厂商的可用模型列表，支持获取、搜索和选择
 */

import chalk from "chalk";

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  description?: string;
  maxContextLength?: number;
  supportsVision?: boolean;
  supportsFunctionCalling?: boolean;
  isDefault?: boolean;
}

/**
 * 各厂商的默认模型列表（用于 API 不可用时回退）
 */
const DEFAULT_MODELS: Record<string, { id: string; name: string; description?: string }[]> = {
  openai: [
    { id: "gpt-4o", name: "GPT-4o", description: "最快的旗舰模型" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", description: "经济高效的小模型" },
    { id: "o1-preview", name: "o1 Preview", description: "推理专用模型" },
    { id: "o1-mini", name: "o1 Mini", description: "轻量推理模型" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo", description: "上一代旗舰" },
  ],
  anthropic: [
    { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet", description: "最强代码能力" },
    { id: "claude-3-opus-latest", name: "Claude 3 Opus", description: "最强大的通用模型" },
    { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", description: "快速响应" },
  ],
  deepseek: [
    { id: "deepseek-chat", name: "DeepSeek Chat", description: "高性价比" },
    { id: "deepseek-coder", name: "DeepSeek Coder", description: "代码专用" },
  ],
  moonshot: [
    { id: "moonshot-v1-8k", name: "Kimi 8K", description: "8K 上下文" },
    { id: "moonshot-v1-32k", name: "Kimi 32K", description: "32K 上下文" },
    { id: "moonshot-v1-128k", name: "Kimi 128K", description: "128K 超长上下文" },
  ],
  zhipu: [
    { id: "glm-4", name: "GLM-4", description: "旗舰模型" },
    { id: "glm-4-air", name: "GLM-4 Air", description: "平衡性能" },
    { id: "glm-4-flash", name: "GLM-4 Flash", description: "快速响应" },
  ],
  google: [
    { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash", description: "最新实验性模型" },
    { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", description: "多模态旗舰" },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", description: "快速响应" },
  ],
};

/**
 * 模型管理器类
 */
export class ModelManager {
  private apiBaseUrl: string;
  private cache: Map<string, ModelInfo[]> = new Map();
  private lastFetchTime: Map<string, number> = new Map();
  private readonly CACHE_TTL = 10 * 60 * 1000; // 10 分钟缓存

  constructor(apiBaseUrl?: string) {
    this.apiBaseUrl = apiBaseUrl || process.env.API_BASE_URL || "http://localhost:3000";
  }

  /**
   * 获取某个厂商的模型列表
   */
  async getModels(providerId: string, forceRefresh = false): Promise<ModelInfo[]> {
    const now = Date.now();
    const cached = this.cache.get(providerId);
    const lastFetch = this.lastFetchTime.get(providerId);

    if (!forceRefresh && cached && lastFetch && now - lastFetch < this.CACHE_TTL) {
      return cached;
    }

    try {
      // 尝试从 API 获取
      const response = await fetch(`${this.apiBaseUrl}/api/settings/keys/${providerId}`, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const keyInfo = await response.json();
        // 如果有 API Key，尝试获取模型列表
        const modelsResponse = await fetch(`${this.apiBaseUrl}/api/models`, {
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (modelsResponse.ok) {
          const data = await modelsResponse.json();
          const models = (data.models || []).map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
            provider: providerId,
            providerName: this.getProviderName(providerId),
            description: m.description,
            maxContextLength: m.maxContextLength,
            supportsVision: m.supportsVision,
            supportsFunctionCalling: m.supportsFunctionCalling,
          }));

          if (models.length > 0) {
            this.cache.set(providerId, models);
            this.lastFetchTime.set(providerId, now);
            return models;
          }
        }
      }
    } catch (error) {
      // API 调用失败，使用默认列表
    }

    // 使用默认模型列表
    const defaultModels = DEFAULT_MODELS[providerId] || [];
    const models: ModelInfo[] = defaultModels.map(m => ({
      id: m.id,
      name: m.name,
      provider: providerId,
      providerName: this.getProviderName(providerId),
      description: m.description,
    }));

    this.cache.set(providerId, models);
    this.lastFetchTime.set(providerId, now);

    return models;
  }

  /**
   * 获取所有已配置厂商的模型列表
   */
  async getAllModels(): Promise<ModelInfo[]> {
    const { createAPIKeyManager } = await import("./api-key-manager.js");
    const keyManager = createAPIKeyManager(this.apiBaseUrl);
    
    const configuredKeys = await keyManager.listConfiguredKeys();
    const allModels: ModelInfo[] = [];

    for (const key of configuredKeys) {
      if (key.enabled) {
        const models = await this.getModels(key.provider);
        allModels.push(...models);
      }
    }

    return allModels;
  }

  /**
   * 搜索模型
   */
  async searchModels(query: string): Promise<ModelInfo[]> {
    const allModels = await this.getAllModels();
    const lowerQuery = query.toLowerCase();

    return allModels.filter(model => 
      model.id.toLowerCase().includes(lowerQuery) ||
      model.name.toLowerCase().includes(lowerQuery) ||
      (model.description && model.description.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * 根据模型 ID 获取模型信息
   */
  async getModelById(modelId: string): Promise<ModelInfo | undefined> {
    const allModels = await this.getAllModels();
    return allModels.find(m => m.id === modelId);
  }

  /**
   * 获取厂商名称
   */
  private getProviderName(providerId: string): string {
    const provider = {
      openai: "OpenAI",
      anthropic: "Anthropic",
      deepseek: "DeepSeek",
      moonshot: "Moonshot",
      zhipu: "智谱 AI",
      google: "Google AI",
    }[providerId];

    return provider || providerId;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.lastFetchTime.clear();
  }
}

/**
 * 创建模型管理器实例
 */
export function createModelManager(apiBaseUrl?: string): ModelManager {
  return new ModelManager(apiBaseUrl);
}
