/**
 * CodingPlan 多账户管理器
 */

import { nanoid } from "nanoid";
import type { CodingPlanAccount, CodingPlanConfig, CodingPlanProvider } from "./types.js";
import { encrypt, decrypt, readStore, writeStore } from "./token-store.js";
import { getProviderPreset, listProviders, getBaseUrl } from "./providers.js";

const DEFAULT_CONFIG: CodingPlanConfig = {
  accounts: [],
  activeAccountId: "",
  globalDefaults: {
    maxTokens: 4096,
    temperature: 0.7,
    preferredProtocol: "openai",
  },
};

export class CodingPlanAccountManager {
  private config: CodingPlanConfig;

  constructor() {
    this.config = readStore<CodingPlanConfig>(DEFAULT_CONFIG);
    // 解密所有 API Keys
    this.config.accounts = this.config.accounts.map((acc) => ({
      ...acc,
      apiKey: this.tryDecrypt(acc.apiKey),
    }));
  }

  private tryDecrypt(value: string): string {
    try {
      return decrypt(value);
    } catch {
      return value; // 可能是未加密的旧数据
    }
  }

  private save(): void {
    // 加密 API Keys 后保存
    const toSave: CodingPlanConfig = {
      ...this.config,
      accounts: this.config.accounts.map((acc) => ({
        ...acc,
        apiKey: encrypt(acc.apiKey),
      })),
    };
    writeStore(toSave);
  }

  /**
   * 添加账户
   */
  async addAccount(
    provider: CodingPlanProvider,
    apiKey: string,
    options?: {
      alias?: string;
      protocol?: "openai" | "anthropic";
      baseUrl?: string;
      defaultModel?: string;
      metadata?: CodingPlanAccount["metadata"];
    }
  ): Promise<CodingPlanAccount> {
    const preset = getProviderPreset(provider);
    const protocol = options?.protocol || this.config.globalDefaults.preferredProtocol;

    let baseUrl = options?.baseUrl;
    if (!baseUrl && preset) {
      baseUrl = getBaseUrl(preset, protocol);
    }
    if (!baseUrl) {
      throw new Error(`No base URL configured for provider "${provider}" with protocol "${protocol}"`);
    }

    const isFirst = this.config.accounts.length === 0;
    const resolvedModel = options?.defaultModel ?? preset?.models[0];
    const account: CodingPlanAccount = {
      id: nanoid(10),
      alias: options?.alias || `${provider}-${nanoid(4)}`,
      provider,
      apiKey,
      baseUrl,
      protocol,
      isActive: isFirst,
      createdAt: new Date().toISOString(),
      ...(resolvedModel !== undefined ? { defaultModel: resolvedModel } : {}),
      ...(options?.metadata ? { metadata: options.metadata } : {}),
    };

    this.config.accounts.push(account);

    if (account.isActive) {
      this.config.activeAccountId = account.id;
    }

    this.save();
    return account;
  }

  /**
   * 删除账户
   */
  async removeAccount(id: string): Promise<void> {
    this.config.accounts = this.config.accounts.filter((a) => a.id !== id);

    if (this.config.activeAccountId === id) {
      const first = this.config.accounts[0];
      if (first) {
        first.isActive = true;
        this.config.activeAccountId = first.id;
      } else {
        this.config.activeAccountId = "";
      }
    }

    this.save();
  }

  /**
   * 更新账户
   */
  async updateAccount(id: string, updates: Partial<CodingPlanAccount>): Promise<void> {
    const account = this.config.accounts.find((a) => a.id === id);
    if (!account) throw new Error(`Account not found: ${id}`);

    Object.assign(account, updates);
    this.save();
  }

  /**
   * 切换账户
   */
  async switchAccount(id: string): Promise<void> {
    const account = this.config.accounts.find((a) => a.id === id);
    if (!account) throw new Error(`Account not found: ${id}`);

    // 取消之前的激活状态
    for (const acc of this.config.accounts) {
      acc.isActive = false;
    }

    account.isActive = true;
    account.lastUsedAt = new Date().toISOString();
    this.config.activeAccountId = id;

    this.save();
  }

  /**
   * 获取当前激活账户
   */
  async getActiveAccount(): Promise<CodingPlanAccount> {
    const account = this.config.accounts.find((a) => a.id === this.config.activeAccountId);
    if (!account) {
      throw new Error("No active account. Run 'sacode auth add' to add one.");
    }
    return account;
  }

  /**
   * 列出所有账户
   */
  async listAccounts(): Promise<CodingPlanAccount[]> {
    return [...this.config.accounts];
  }

  /**
   * 按厂商获取账户
   */
  getAccountsByProvider(provider: CodingPlanProvider): CodingPlanAccount[] {
    return this.config.accounts.filter((a) => a.provider === provider);
  }

  /**
   * 列出所有支持的厂商
   */
  getProviders() {
    return listProviders();
  }

  /**
   * 获取厂商预设
   */
  getPreset(provider: CodingPlanProvider) {
    return getProviderPreset(provider);
  }

  /**
   * 验证账户（尝试调用 API）
   */
  async validateAccount(id: string): Promise<{ valid: boolean; error?: string }> {
    const account = this.config.accounts.find((a) => a.id === id);
    if (!account) return { valid: false, error: "Account not found" };

    try {
      // 尝试发送简单请求
      const endpoint = account.protocol === "anthropic"
        ? `${account.baseUrl}/v1/messages`
        : `${account.baseUrl}/chat/completions`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (account.protocol === "anthropic") {
        headers["x-api-key"] = account.apiKey;
        headers["anthropic-version"] = "2023-06-01";
      } else {
        headers["Authorization"] = `Bearer ${account.apiKey}`;
      }

      const body = account.protocol === "anthropic"
        ? { model: account.defaultModel || "claude-3-sonnet", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }
        : { model: account.defaultModel || "gpt-4", max_tokens: 1, messages: [{ role: "user", content: "hi" }] };

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok || response.status === 400) {
        // 400 may mean bad model but auth is valid
        return { valid: true };
      }

      const errorBody = await response.text();
      return { valid: false, error: `HTTP ${response.status}: ${errorBody.slice(0, 200)}` };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * 获取全局默认配置
   */
  getGlobalDefaults() {
    return this.config.globalDefaults;
  }
}
