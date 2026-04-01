/**
 * 多模型管理器
 *
 * 支持多 AI 模型切换、配置管理、模型选择策略
 */

import { z } from "zod";
import EventEmitter from "eventemitter3";

// ============================================
// 类型定义
// ============================================

/**
 * 模型提供商
 */
export type ModelProvider = "openai" | "anthropic" | "google" | "deepseek" | "moonshot" | "zhipu" | "custom";

/**
 * 模型配置
 */
export const ModelConfigSchema = z.object({
  /** 模型唯一标识 */
  id: z.string(),
  /** 模型显示名称 */
  name: z.string(),
  /** 提供商 */
  provider: z.enum(["openai", "anthropic", "google", "deepseek", "moonshot", "zhipu", "custom"]),
  /** 模型标识符（如 gpt-4o, claude-3-opus） */
  model: z.string(),
  /** API 密钥 */
  apiKey: z.string().optional(),
  /** API 端点 */
  endpoint: z.string().optional(),
  /** 最大 Token 数 */
  maxTokens: z.number().default(4096),
  /** 温度参数 */
  temperature: z.number().min(0).max(2).default(0.7),
  /** 系统提示词 */
  systemPrompt: z.string().optional(),
  /** 是否为默认模型 */
  isDefault: z.boolean().default(false),
  /** 是否启用 */
  enabled: z.boolean().default(true),
  /** 模型能力 */
  capabilities: z.object({
    /** 支持流式输出 */
    streaming: z.boolean().default(true),
    /** 支持视觉 */
    vision: z.boolean().default(false),
    /** 支持函数调用 */
    functionCalling: z.boolean().default(true),
    /** 支持长上下文 */
    longContext: z.boolean().default(false),
    /** 最大上下文长度 */
    maxContextLength: z.number().default(8192),
  }).default({}),
  /** 元数据 */
  metadata: z.record(z.unknown()).optional(),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/**
 * 模型选择策略
 */
export type ModelSelectionStrategy = 
  | "default"       // 使用默认模型
  | "round-robin"   // 轮询选择
  | "random"        // 随机选择
  | "capability"    // 按能力选择
  | "cost"          // 按成本选择
  | "custom";       // 自定义策略

/**
 * 模型管理器配置
 */
export const ModelManagerConfigSchema = z.object({
  /** 默认模型 ID */
  defaultModelId: z.string().optional(),
  /** 选择策略 */
  selectionStrategy: z.enum(["default", "round-robin", "random", "capability", "cost", "custom"]).default("default"),
  /** 模型列表 */
  models: z.array(ModelConfigSchema).default([]),
  /** 模型切换回调 */
  onModelSwitch: z.function().optional(),
  /** 自定义选择函数 */
  customSelector: z.function().optional(),
});

export type ModelManagerConfig = z.infer<typeof ModelManagerConfigSchema>;

/**
 * 模型切换事件
 */
export interface ModelSwitchEvent {
  previousModel: ModelConfig | null;
  currentModel: ModelConfig;
  sessionId: string | undefined;
  reason: "user" | "strategy" | "capability" | "fallback";
}

/**
 * 模型能力需求
 */
export interface ModelCapabilityRequirement {
  vision?: boolean;
  functionCalling?: boolean;
  longContext?: boolean;
  minContextLength?: number;
}

// ============================================
// 预设模型模板
// ============================================

export const ModelTemplates: Record<string, Partial<ModelConfig>> = {
  // OpenAI
  "gpt-4o": {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    model: "gpt-4o",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: true,
      functionCalling: true,
      longContext: true,
      maxContextLength: 128000,
    },
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    model: "gpt-4o-mini",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: true,
      functionCalling: true,
      longContext: true,
      maxContextLength: 128000,
    },
  },
  "gpt-4-turbo": {
    id: "gpt-4-turbo",
    name: "GPT-4 Turbo",
    provider: "openai",
    model: "gpt-4-turbo",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: true,
      functionCalling: true,
      longContext: true,
      maxContextLength: 128000,
    },
  },

  // Anthropic
  "claude-3-opus": {
    id: "claude-3-opus",
    name: "Claude 3 Opus",
    provider: "anthropic",
    model: "claude-3-opus-20240229",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: true,
      functionCalling: true,
      longContext: true,
      maxContextLength: 200000,
    },
  },
  "claude-3-sonnet": {
    id: "claude-3-sonnet",
    name: "Claude 3 Sonnet",
    provider: "anthropic",
    model: "claude-3-sonnet-20240229",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: true,
      functionCalling: true,
      longContext: true,
      maxContextLength: 200000,
    },
  },
  "claude-3-haiku": {
    id: "claude-3-haiku",
    name: "Claude 3 Haiku",
    provider: "anthropic",
    model: "claude-3-haiku-20240307",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: true,
      functionCalling: true,
      longContext: true,
      maxContextLength: 200000,
    },
  },

  // Google
  "gemini-pro": {
    id: "gemini-pro",
    name: "Gemini Pro",
    provider: "google",
    model: "gemini-pro",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: false,
      functionCalling: true,
      longContext: true,
      maxContextLength: 32000,
    },
  },
  "gemini-pro-vision": {
    id: "gemini-pro-vision",
    name: "Gemini Pro Vision",
    provider: "google",
    model: "gemini-pro-vision",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: true,
      functionCalling: false,
      longContext: false,
      maxContextLength: 16384,
    },
  },

  // DeepSeek
  "deepseek-chat": {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    provider: "deepseek",
    model: "deepseek-chat",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: false,
      functionCalling: true,
      longContext: true,
      maxContextLength: 64000,
    },
  },
  "deepseek-coder": {
    id: "deepseek-coder",
    name: "DeepSeek Coder",
    provider: "deepseek",
    model: "deepseek-coder",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: false,
      functionCalling: true,
      longContext: true,
      maxContextLength: 64000,
    },
  },

  // Moonshot
  "moonshot-v1-8k": {
    id: "moonshot-v1-8k",
    name: "Moonshot V1 8K",
    provider: "moonshot",
    model: "moonshot-v1-8k",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: false,
      functionCalling: true,
      longContext: false,
      maxContextLength: 8192,
    },
  },
  "moonshot-v1-32k": {
    id: "moonshot-v1-32k",
    name: "Moonshot V1 32K",
    provider: "moonshot",
    model: "moonshot-v1-32k",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: false,
      functionCalling: true,
      longContext: true,
      maxContextLength: 32768,
    },
  },

  // 智谱
  "glm-4": {
    id: "glm-4",
    name: "GLM-4",
    provider: "zhipu",
    model: "glm-4",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: false,
      functionCalling: true,
      longContext: true,
      maxContextLength: 128000,
    },
  },
  "glm-4v": {
    id: "glm-4v",
    name: "GLM-4V",
    provider: "zhipu",
    model: "glm-4v",
    maxTokens: 4096,
    capabilities: {
      streaming: true,
      vision: true,
      functionCalling: true,
      longContext: true,
      maxContextLength: 128000,
    },
  },
};

// ============================================
// 模型管理器
// ============================================

export class ModelManager extends EventEmitter<{
  switch: (event: ModelSwitchEvent) => void;
  add: (model: ModelConfig) => void;
  remove: (modelId: string) => void;
  update: (model: ModelConfig) => void;
}> {
  private models: Map<string, ModelConfig> = new Map();
  private defaultModelId: string | null = null;
  private currentModelId: Map<string, string> = new Map(); // sessionId -> modelId
  private selectionStrategy: ModelSelectionStrategy;
  private roundRobinIndex = 0;
  private customSelector?: (requirements?: ModelCapabilityRequirement) => string | null;

  constructor(config: Partial<ModelManagerConfig> = {}) {
    super();

    // 加载模型配置
    for (const model of config.models ?? []) {
      this.addModel(model);
    }

    // 设置默认模型
    if (config.defaultModelId) {
      this.defaultModelId = config.defaultModelId;
    } else {
      // 查找第一个标记为默认的模型
      const defaultModel = Array.from(this.models.values()).find((m) => m.isDefault);
      if (defaultModel) {
        this.defaultModelId = defaultModel.id;
      } else if (this.models.size > 0) {
        this.defaultModelId = this.models.keys().next().value ?? null;
      }
    }

    this.selectionStrategy = config.selectionStrategy ?? "default";
    
    if (config.customSelector) {
      this.customSelector = config.customSelector as (requirements?: ModelCapabilityRequirement) => string | null;
    }
  }

  /**
   * 添加模型
   */
  addModel(config: Partial<ModelConfig> & { id: string }): ModelConfig {
    const model = ModelConfigSchema.parse({
      ...config,
      capabilities: {
        streaming: true,
        vision: false,
        functionCalling: true,
        longContext: false,
        maxContextLength: 8192,
        ...config.capabilities,
      },
    });

    this.models.set(model.id, model);

    // 如果是第一个模型或标记为默认，设置为默认模型
    if (model.isDefault || this.models.size === 1) {
      this.defaultModelId = model.id;
    }

    this.emit("add", model);
    return model;
  }

  /**
   * 从模板添加模型
   */
  addModelFromTemplate(templateId: string, overrides: Partial<ModelConfig> = {}): ModelConfig | null {
    const template = ModelTemplates[templateId];
    if (!template) {
      return null;
    }

    return this.addModel({
      ...template,
      ...overrides,
      id: overrides.id ?? templateId,
    } as ModelConfig);
  }

  /**
   * 移除模型
   */
  removeModel(modelId: string): boolean {
    const model = this.models.get(modelId);
    if (!model) {
      return false;
    }

    this.models.delete(modelId);

    // 如果移除的是默认模型，重新选择
    if (this.defaultModelId === modelId) {
      this.defaultModelId = this.models.size > 0 
        ? this.models.keys().next().value ?? null 
        : null;
    }

    this.emit("remove", modelId);
    return true;
  }

  /**
   * 更新模型配置
   */
  updateModel(modelId: string, updates: Partial<ModelConfig>): ModelConfig | null {
    const existing = this.models.get(modelId);
    if (!existing) {
      return null;
    }

    const updated = ModelConfigSchema.parse({
      ...existing,
      ...updates,
      capabilities: {
        ...existing.capabilities,
        ...updates.capabilities,
      },
    });

    this.models.set(modelId, updated);

    if (updated.isDefault) {
      this.defaultModelId = modelId;
    }

    this.emit("update", updated);
    return updated;
  }

  /**
   * 获取模型配置
   */
  getModel(modelId: string): ModelConfig | undefined {
    return this.models.get(modelId);
  }

  /**
   * 获取所有模型
   */
  getAllModels(): ModelConfig[] {
    return Array.from(this.models.values());
  }

  /**
   * 获取启用的模型
   */
  getEnabledModels(): ModelConfig[] {
    return this.getAllModels().filter((m) => m.enabled);
  }

  /**
   * 获取默认模型
   */
  getDefaultModel(): ModelConfig | undefined {
    if (!this.defaultModelId) {
      return undefined;
    }
    return this.models.get(this.defaultModelId);
  }

  /**
   * 设置默认模型
   */
  setDefaultModel(modelId: string): boolean {
    if (!this.models.has(modelId)) {
      return false;
    }

    // 移除旧默认标记
    const oldDefault = this.getDefaultModel();
    if (oldDefault) {
      oldDefault.isDefault = false;
    }

    // 设置新默认
    const model = this.models.get(modelId);
    if (model) {
      model.isDefault = true;
      this.defaultModelId = modelId;
    }

    return true;
  }

  /**
   * 获取会话当前模型
   */
  getSessionModel(sessionId?: string): ModelConfig | undefined {
    if (sessionId) {
      const modelId = this.currentModelId.get(sessionId);
      if (modelId) {
        return this.models.get(modelId);
      }
    }
    return this.getDefaultModel();
  }

  /**
   * 切换会话模型
   */
  switchModel(modelId: string, sessionId?: string, reason: ModelSwitchEvent["reason"] = "user"): ModelConfig | undefined {
    const model = this.models.get(modelId);
    if (!model || !model.enabled) {
      return undefined;
    }

    const previousModel = sessionId ? this.getSessionModel(sessionId) ?? null : this.getDefaultModel() ?? null;

    if (sessionId) {
      this.currentModelId.set(sessionId, modelId);
    } else {
      this.defaultModelId = modelId;
    }

    const event: ModelSwitchEvent = {
      previousModel,
      currentModel: model,
      sessionId,
      reason,
    };

    this.emit("switch", event);
    return model;
  }

  /**
   * 根据能力需求选择模型
   */
  selectModelByCapability(requirements: ModelCapabilityRequirement): ModelConfig | undefined {
    const candidates = this.getEnabledModels().filter((m) => {
      const caps = m.capabilities;

      if (requirements.vision && !caps.vision) return false;
      if (requirements.functionCalling && !caps.functionCalling) return false;
      if (requirements.longContext && !caps.longContext) return false;
      if (requirements.minContextLength && caps.maxContextLength < requirements.minContextLength) {
        return false;
      }

      return true;
    });

    if (candidates.length === 0) {
      return this.getDefaultModel();
    }

    // 返回第一个匹配的模型
    return candidates[0];
  }

  /**
   * 根据策略选择模型
   */
  selectModel(
    sessionId?: string,
    requirements?: ModelCapabilityRequirement
  ): ModelConfig | undefined {
    // 如果会话已有模型，优先使用
    if (sessionId) {
      const sessionModel = this.getSessionModel(sessionId);
      if (sessionModel && sessionModel.enabled) {
        return sessionModel;
      }
    }

    // 按能力选择
    if (requirements && this.selectionStrategy === "capability") {
      return this.selectModelByCapability(requirements);
    }

    const enabledModels = this.getEnabledModels();
    if (enabledModels.length === 0) {
      return undefined;
    }

    switch (this.selectionStrategy) {
      case "default":
        return this.getDefaultModel();

      case "round-robin":
        this.roundRobinIndex = (this.roundRobinIndex + 1) % enabledModels.length;
        return enabledModels[this.roundRobinIndex];

      case "random":
        return enabledModels[Math.floor(Math.random() * enabledModels.length)];

      case "custom":
        if (this.customSelector) {
          const selectedId = this.customSelector(requirements);
          if (selectedId) {
            return this.models.get(selectedId);
          }
        }
        return this.getDefaultModel();

      default:
        return this.getDefaultModel();
    }
  }

  /**
   * 获取模型 API 配置
   */
  getModelApiConfig(modelId: string): {
    endpoint: string;
    headers: Record<string, string>;
    model: string;
  } | null {
    const model = this.models.get(modelId);
    if (!model) {
      return null;
    }

    const endpoints: Record<ModelProvider, string> = {
      openai: "https://api.openai.com/v1",
      anthropic: "https://api.anthropic.com/v1",
      google: "https://generativelanguage.googleapis.com/v1beta",
      deepseek: "https://api.deepseek.com/v1",
      moonshot: "https://api.moonshot.cn/v1",
      zhipu: "https://open.bigmodel.cn/api/paas/v4",
      custom: model.endpoint ?? "https://api.example.com/v1",
    };

    const headers: Record<string, string> = {};

    switch (model.provider) {
      case "openai":
      case "deepseek":
      case "moonshot":
      case "custom":
        headers["Authorization"] = `Bearer ${model.apiKey ?? ""}`;
        break;
      case "anthropic":
        headers["x-api-key"] = model.apiKey ?? "";
        headers["anthropic-version"] = "2024-01-01";
        break;
      case "google":
        // Google 使用 query parameter
        break;
      case "zhipu":
        headers["Authorization"] = `Bearer ${model.apiKey ?? ""}`;
        break;
    }

    return {
      endpoint: model.endpoint ?? endpoints[model.provider],
      headers,
      model: model.model,
    };
  }

  /**
   * 清除会话模型绑定
   */
  clearSessionModel(sessionId: string): void {
    this.currentModelId.delete(sessionId);
  }

  /**
   * 导出配置
   */
  exportConfig(): {
    defaultModelId: string | null;
    selectionStrategy: ModelSelectionStrategy;
    models: ModelConfig[];
  } {
    return {
      defaultModelId: this.defaultModelId,
      selectionStrategy: this.selectionStrategy,
      models: this.getAllModels(),
    };
  }

  /**
   * 导入配置
   */
  importConfig(config: {
    defaultModelId?: string;
    selectionStrategy?: ModelSelectionStrategy;
    models?: ModelConfig[];
  }): void {
    // 清空现有模型
    this.models.clear();
    this.currentModelId.clear();

    // 导入模型
    for (const model of config.models ?? []) {
      this.addModel(model);
    }

    // 设置默认模型
    if (config.defaultModelId && this.models.has(config.defaultModelId)) {
      this.defaultModelId = config.defaultModelId;
    }

    // 设置策略
    if (config.selectionStrategy) {
      this.selectionStrategy = config.selectionStrategy;
    }
  }
}

// ============================================
// 工厂函数
// ============================================

export function createModelManager(config?: Partial<ModelManagerConfig>): ModelManager {
  return new ModelManager(config);
}

/**
 * 创建默认模型管理器（包含常用模型模板）
 */
export function createDefaultModelManager(): ModelManager {
  return new ModelManager({
    selectionStrategy: "default",
  });
}

// ============================================
// Category-based Router 导出
// ============================================

export {
  CategoryRouter,
  createCategoryRouter,
  classifyTask,
  routeTask,
  DefaultCategoryDescriptors,
  type TaskCategory,
  type CategoryDescriptor,
  type CategoryRecognitionResult,
  type CategoryRouterConfig,
  type CategoryClassificationRule,
} from "./category-router";
