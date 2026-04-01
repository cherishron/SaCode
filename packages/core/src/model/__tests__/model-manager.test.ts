/**
 * ModelManager 测试
 * 测试模型管理器的核心功能：模型配置、切换、选择策略等
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ModelManager,
  createModelManager,
  createDefaultModelManager,
  ModelTemplates,
} from "../index";
import type { ModelConfig, ModelCapabilityRequirement } from "../index";

describe("ModelManager", () => {
  let manager: ModelManager;

  const models: ModelConfig[] = [
    {
      id: "gpt-4o",
      name: "GPT-4o",
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test-key",
      maxTokens: 4096,
      temperature: 0.7,
      isDefault: true,
      enabled: true,
      capabilities: {
        streaming: true,
        vision: true,
        functionCalling: true,
        longContext: true,
        maxContextLength: 128000,
      },
    },
    {
      id: "claude-3-sonnet",
      name: "Claude 3 Sonnet",
      provider: "anthropic",
      model: "claude-3-sonnet-20240229",
      apiKey: "sk-ant-test-key",
      maxTokens: 4096,
      temperature: 0.7,
      isDefault: false,
      enabled: true,
      capabilities: {
        streaming: true,
        vision: true,
        functionCalling: true,
        longContext: true,
        maxContextLength: 200000,
      },
    },
    {
      id: "deepseek-chat",
      name: "DeepSeek Chat",
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "sk-ds-key",
      maxTokens: 4096,
      temperature: 0.7,
      isDefault: false,
      enabled: true,
      capabilities: {
        streaming: true,
        vision: false,
        functionCalling: true,
        longContext: true,
        maxContextLength: 64000,
      },
    },
  ];

  beforeEach(() => {
    manager = new ModelManager({
      models,
      defaultModelId: "gpt-4o",
      selectionStrategy: "default",
    });
  });

  describe("初始化", () => {
    it("应该创建 ModelManager 实例", () => {
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(ModelManager);
    });

    it("应该使用默认配置", () => {
      const defaultManager = createDefaultModelManager();
      expect(defaultManager).toBeDefined();
    });

    it("应该加载预设模型模板", () => {
      expect(ModelTemplates).toBeDefined();
      expect(Object.keys(ModelTemplates).length).toBeGreaterThan(0);
      expect(ModelTemplates["gpt-4o"]).toBeDefined();
    });
  });

  describe("模型配置管理", () => {
    it("应该获取所有模型", () => {
      const allModels = manager.getAllModels();
      expect(allModels).toHaveLength(3);
    });

    it("应该获取启用的模型", () => {
      const enabled = manager.getEnabledModels();
      expect(enabled.length).toBeGreaterThan(0);
      expect(enabled.every(m => m.enabled)).toBe(true);
    });

    it("应该通过 ID 获取模型", () => {
      const model = manager.getModel("gpt-4o");
      expect(model).toBeDefined();
      expect(model?.id).toBe("gpt-4o");
      expect(model?.name).toBe("GPT-4o");
    });

    it("应该返回 undefined 对于不存在的模型", () => {
      const model = manager.getModel("non-existent");
      expect(model).toBeUndefined();
    });

    it("应该添加模型", () => {
      const newModel: ModelConfig = {
        id: "new-model",
        name: "New Model",
        provider: "custom",
        model: "custom-model",
        maxTokens: 2048,
        temperature: 0.5,
        enabled: true,
        capabilities: {
          streaming: true,
          vision: false,
          functionCalling: false,
          longContext: false,
          maxContextLength: 4096,
        },
      };

      manager.addModel(newModel);
      const model = manager.getModel("new-model");
      expect(model).toBeDefined();
      expect(model?.id).toBe("new-model");
    });

    it("应该更新模型", () => {
      manager.updateModel("gpt-4o", { temperature: 0.9 });

      const model = manager.getModel("gpt-4o");
      expect(model?.temperature).toBe(0.9);
    });

    it("应该删除模型", () => {
      manager.deleteModel("deepseek-chat");

      const model = manager.getModel("deepseek-chat");
      expect(model).toBeUndefined();
    });

    it("应该禁用模型", () => {
      manager.disableModel("gpt-4o");

      const model = manager.getModel("gpt-4o");
      expect(model?.enabled).toBe(false);
    });

    it("应该启用模型", () => {
      manager.disableModel("gpt-4o");
      manager.enableModel("gpt-4o");

      const model = manager.getModel("gpt-4o");
      expect(model?.enabled).toBe(true);
    });
  });

  describe("默认模型", () => {
    it("应该获取默认模型", () => {
      const defaultModel = manager.getDefaultModel();
      expect(defaultModel).toBeDefined();
      expect(defaultModel?.id).toBe("gpt-4o");
    });

    it("应该设置默认模型", () => {
      manager.setDefaultModel("claude-3-sonnet");

      const defaultModel = manager.getDefaultModel();
      expect(defaultModel?.id).toBe("claude-3-sonnet");
    });

    it("应该在没有默认模型时返回第一个启用的模型", () => {
      const emptyManager = new ModelManager({
        models: [{
          id: "only-model",
          name: "Only Model",
          provider: "openai",
          model: "gpt-3.5-turbo",
          maxTokens: 4096,
          enabled: true,
          capabilities: {
            streaming: true,
            vision: false,
            functionCalling: true,
            longContext: false,
            maxContextLength: 4096,
          },
        }],
        selectionStrategy: "default",
      });

      const defaultModel = emptyManager.getDefaultModel();
      expect(defaultModel).toBeDefined();
    });
  });

  describe("模型选择", () => {
    it("应该选择当前模型", () => {
      const current = manager.selectModel();
      expect(current).toBeDefined();
      expect(current?.id).toBe("gpt-4o");
    });

    it("应该按能力选择模型", () => {
      const requirement: ModelCapabilityRequirement = {
        vision: true,
        functionCalling: true,
      };

      const model = manager.selectModelByCapability(requirement);
      expect(model).toBeDefined();
      expect(model?.capabilities.vision).toBe(true);
      expect(model?.capabilities.functionCalling).toBe(true);
    });

    it("应该选择支持长上下文的模型", () => {
      const requirement: ModelCapabilityRequirement = {
        longContext: true,
        minContextLength: 100000,
      };

      const model = manager.selectModelByCapability(requirement);
      expect(model).toBeDefined();
      expect(model?.capabilities.longContext).toBe(true);
      expect(model?.capabilities.maxContextLength).toBeGreaterThanOrEqual(100000);
    });

    it("应该返回 undefined 如果没有满足能力的模型", () => {
      const requirement: ModelCapabilityRequirement = {
        vision: true,
        longContext: true,
        minContextLength: 500000,
      };

      const model = manager.selectModelByCapability(requirement);
      expect(model).toBeUndefined();
    });
  });

  describe("选择策略", () => {
    it("应该使用 default 策略", () => {
      const defaultManager = new ModelManager({
        models,
        defaultModelId: "gpt-4o",
        selectionStrategy: "default",
      });

      const model = defaultManager.selectModel();
      expect(model?.id).toBe("gpt-4o");
    });

    it("应该使用 round-robin 策略", () => {
      const rrManager = new ModelManager({
        models,
        defaultModelId: "gpt-4o",
        selectionStrategy: "round-robin",
      });

      const model1 = rrManager.selectModel();
      const model2 = rrManager.selectModel();
      const model3 = rrManager.selectModel();

      // 轮询应该选择不同的模型
      expect(model1?.id).not.toBe(model2?.id);
    });

    it("应该使用 random 策略", () => {
      const randomManager = new ModelManager({
        models,
        defaultModelId: "gpt-4o",
        selectionStrategy: "random",
      });

      const model = randomManager.selectModel();
      expect(model).toBeDefined();
      expect(model?.enabled).toBe(true);
    });

    it("应该使用 capability 策略", () => {
      const capManager = new ModelManager({
        models,
        defaultModelId: "gpt-4o",
        selectionStrategy: "capability",
      });

      const requirement: ModelCapabilityRequirement = {
        vision: true,
      };

      const model = capManager.selectModelByCapability(requirement);
      expect(model).toBeDefined();
      expect(model?.capabilities.vision).toBe(true);
    });
  });

  describe("模型切换事件", () => {
    it("应该发射 model:switched 事件", () => {
      const listener = vi.fn();
      manager.on("model:switched", listener);

      manager.selectModel("claude-3-sonnet");

      expect(listener).toHaveBeenCalled();
    });

    it("应该调用 onModelSwitch 回调", () => {
      const callback = vi.fn();
      const callbackManager = new ModelManager({
        models,
        defaultModelId: "gpt-4o",
        onModelSwitch: callback,
      });

      callbackManager.selectModel("claude-3-sonnet");

      expect(callback).toHaveBeenCalled();
    });
  });

  describe("模型验证", () => {
    it("应该验证模型配置", () => {
      const validModel: ModelConfig = {
        id: "valid",
        name: "Valid Model",
        provider: "openai",
        model: "gpt-4o",
        maxTokens: 4096,
        enabled: true,
        capabilities: {
          streaming: true,
          vision: false,
          functionCalling: true,
          longContext: false,
          maxContextLength: 8192,
        },
      };

      expect(() => manager.addModel(validModel)).not.toThrow();
    });

    it("应该拒绝无效的模型配置", () => {
      const invalidModel = {
        id: "invalid",
        name: "Invalid Model",
        provider: "invalid-provider",
        model: "test",
      } as unknown as ModelConfig;

      expect(() => manager.addModel(invalidModel)).toThrow();
    });
  });

  describe("统计信息", () => {
    it("应该获取统计信息", () => {
      const stats = manager.getStats();

      expect(stats.total).toBe(3);
      expect(stats.enabled).toBe(3);
      expect(stats.disabled).toBe(0);
      expect(stats.byProvider.openai).toBe(1);
      expect(stats.byProvider.anthropic).toBe(1);
      expect(stats.byProvider.deepseek).toBe(1);
    });
  });

  describe("模型模板", () => {
    it("应该使用模板创建模型", () => {
      const template = ModelTemplates["gpt-4o"];
      expect(template).toBeDefined();
      expect(template?.provider).toBe("openai");
      expect(template?.model).toBe("gpt-4o");
    });

    it("应该包含所有预设模板", () => {
      const templates = Object.keys(ModelTemplates);
      expect(templates).toContain("gpt-4o");
      expect(templates).toContain("claude-3-opus");
      expect(templates).toContain("deepseek-chat");
      expect(templates).toContain("moonshot-v1-8k");
      expect(templates).toContain("glm-4");
    });
  });
});

describe("createModelManager", () => {
  it("应该创建 ModelManager 实例", () => {
    const manager = createModelManager({
      models: [],
      selectionStrategy: "default",
    });

    expect(manager).toBeDefined();
    expect(manager).toBeInstanceOf(ModelManager);
  });
});

describe("createDefaultModelManager", () => {
  it("应该创建默认 ModelManager 实例", () => {
    const manager = createDefaultModelManager();

    expect(manager).toBeDefined();
  });
});
