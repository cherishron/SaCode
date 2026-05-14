/**
 * API Key 管理器
 * 
 * 管理用户的 API Key 配置，支持添加、删除、选择和列出
 */

import chalk from "chalk";
import ora from "ora";

export interface APIKeyInfo {
  id: string;
  provider: string;
  name: string;
  maskedKey: string;
  baseUrl?: string | null;
  enabled: boolean;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  defaultBaseUrl?: string;
}

const SUPPORTED_PROVIDERS: ProviderInfo[] = [
  { id: "openai", name: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", defaultBaseUrl: "https://api.anthropic.com" },
  { id: "deepseek", name: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com/v1" },
  { id: "moonshot", name: "Moonshot", defaultBaseUrl: "https://api.moonshot.cn/v1" },
  { id: "zhipu", name: "智谱 AI", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "google", name: "Google AI", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1" },
];

/**
 * API Key 管理器类
 */
export class APIKeyManager {
  private apiBaseUrl: string;
  private cache: Map<string, APIKeyInfo> = new Map();
  private lastFetchTime: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存

  constructor(apiBaseUrl?: string) {
    this.apiBaseUrl = apiBaseUrl || process.env.API_BASE_URL || "http://localhost:3000";
  }

  /**
   * 获取支持的提供商列表
   */
  getSupportedProviders(): ProviderInfo[] {
    return SUPPORTED_PROVIDERS;
  }

  /**
   * 从缓存或 API 获取已配置的 API Key
   */
  async listConfiguredKeys(forceRefresh = false): Promise<APIKeyInfo[]> {
    const now = Date.now();
    if (!forceRefresh && this.cache.size > 0 && now - this.lastFetchTime < this.CACHE_TTL) {
      return Array.from(this.cache.values());
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/settings/keys`, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        // API 服务可能未启动，返回空列表
        return [];
      }

      const data = await response.json() as { keys: APIKeyInfo[] };
      
      this.cache.clear();
      for (const key of data.keys) {
        this.cache.set(key.provider, key);
      }
      this.lastFetchTime = now;

      return data.keys;
    } catch (error) {
      // 网络错误，返回缓存
      return Array.from(this.cache.values());
    }
  }

  /**
   * 检查某个厂商是否已配置
   */
  async isConfigured(providerId: string): Promise<boolean> {
    const keys = await this.listConfiguredKeys();
    return keys.some(k => k.provider === providerId && k.enabled);
  }

  /**
   * 获取某个厂商的 API Key 信息
   */
  async getKey(providerId: string): Promise<APIKeyInfo | undefined> {
    const keys = await this.listConfiguredKeys();
    return keys.find(k => k.provider === providerId);
  }

  /**
   * 添加或更新 API Key
   */
  async addOrUpdateKey(
    providerId: string,
    apiKey: string,
    baseUrl?: string,
    name?: string
  ): Promise<{ success: boolean; error?: string }> {
    const spinner = ora(`保存 ${providerId} API Key...`).start();

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/settings/keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: providerId,
          apiKey,
          baseUrl,
          name: name || SUPPORTED_PROVIDERS.find(p => p.id === providerId)?.name,
          enabled: true,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "保存失败" }));
        spinner.fail(`保存失败：${error.error}`);
        return { success: false, error: error.error };
      }

      const result = await response.json();
      
      // 更新缓存
      this.cache.set(providerId, result.key);
      this.lastFetchTime = Date.now();
      
      spinner.succeed(`已保存 ${providerId} API Key`);
      return { success: true };
    } catch (error) {
      spinner.fail(`保存失败：${error instanceof Error ? error.message : "未知错误"}`);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "未知错误" 
      };
    }
  }

  /**
   * 删除 API Key
   */
  async deleteKey(providerId: string): Promise<{ success: boolean; error?: string }> {
    const spinner = ora(`删除 ${providerId} API Key...`).start();

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/settings/keys/${providerId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "删除失败" }));
        spinner.fail(`删除失败：${error.error}`);
        return { success: false, error: error.error };
      }

      // 更新缓存
      this.cache.delete(providerId);
      
      spinner.succeed(`已删除 ${providerId} API Key`);
      return { success: true };
    } catch (error) {
      spinner.fail(`删除失败：${error instanceof Error ? error.message : "未知错误"}`);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "未知错误" 
      };
    }
  }

  /**
   * 选择/切换当前使用的 API Key
   */
  async selectKey(providerId: string): Promise<{ success: boolean; error?: string }> {
    const key = await this.getKey(providerId);
    
    if (!key) {
      return { success: false, error: `未找到 ${providerId} 的配置` };
    }

    // 更新偏好设置
    const { getPreferenceManager } = await import("@sacode/core");
    const prefs = getPreferenceManager();
    prefs.set("defaultProvider", providerId as "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu");
    
    return { success: true };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.lastFetchTime = 0;
  }

  /**
   * 获取缓存的 Key 数量
   */
  getConfiguredCount(): number {
    return this.cache.size;
  }
}

/**
 * 创建 API Key 管理器实例
 */
export function createAPIKeyManager(apiBaseUrl?: string): APIKeyManager {
  return new APIKeyManager(apiBaseUrl);
}
