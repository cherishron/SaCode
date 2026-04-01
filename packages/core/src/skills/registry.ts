import type {
  ClawHubConfig,
  SkillRegistryEntry,
  SkillSearchResult,
  SkillSearchParams,
  SkillVersion,
} from "./types";

/**
 * 默认 ClawHub 配置
 */
export const DEFAULT_CLAWHUB_CONFIG: Required<Omit<ClawHubConfig, "token">> = {
  registryUrl: "https://api.clawhub.ai/v1",
  siteUrl: "https://clawhub.ai",
  timeout: 30000,
};

/**
 * 默认 SkillHub 配置 (腾讯云镜像)
 *
 * SkillHub 是 ClawHub 的国内镜像站，提供：
 * - 国内高速下载
 * - 解决 ClawHub 限频问题
 * - 中文界面支持
 */
export const DEFAULT_SKILLHUB_CONFIG: Required<Omit<ClawHubConfig, "token">> = {
  registryUrl: "https://skillhub.tencent.com/api/v1",
  siteUrl: "https://skillhub.tencent.com",
  timeout: 30000,
};

/**
 * 注册表类型
 */
export type RegistryType = "clawhub" | "skillhub";

/**
 * 获取默认配置
 */
export function getDefaultConfig(type: RegistryType = "clawhub"): Required<Omit<ClawHubConfig, "token">> {
  return type === "skillhub" ? DEFAULT_SKILLHUB_CONFIG : DEFAULT_CLAWHUB_CONFIG;
}

/**
 * 缓存条目
 */
interface CacheEntry<T = unknown> {
  data: T;
  expires: number;
  size: number;
}

/**
 * 简单 LRU 缓存实现
 */
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 移到末尾表示最近使用
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // 如果已存在，先删除
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // 如果超过大小，删除最旧的（第一个）
    else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * 安全验证错误
 */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * 网络请求错误
 */
export class NetworkError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * SkillRegistry 配置扩展
 */
export interface SkillRegistryConfig extends ClawHubConfig {
  /** 缓存最大条目数，默认 50 */
  maxCacheSize?: number;
  /** 缓存 TTL (毫秒)，默认 5 分钟 */
  cacheTTL?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 重试基础延迟 (毫秒)，默认 1000 */
  retryBaseDelay?: number;
}

/**
 * Skill 注册中心客户端
 *
 * 与 ClawHub API 交互，支持技能搜索、下载和管理
 *
 * @example
 * ```typescript
 * const registry = new SkillRegistry();
 * const results = await registry.search({ query: "calendar" });
 * const skill = await registry.getSkill("my-skill");
 * const versions = await registry.getVersions("my-skill");
 * ```
 */
export class SkillRegistry {
  private config: Required<Omit<ClawHubConfig, "token">> & { token?: string };
  private readonly maxCacheSize: number;
  private readonly cacheTTL: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelay: number;
  private cache: LRUCache<string, CacheEntry>;

  constructor(config?: Partial<SkillRegistryConfig>) {
    this.config = { ...DEFAULT_CLAWHUB_CONFIG, ...config };
    this.maxCacheSize = config?.maxCacheSize ?? 50;
    this.cacheTTL = config?.cacheTTL ?? 5 * 60 * 1000;
    this.maxRetries = config?.maxRetries ?? 3;
    this.retryBaseDelay = config?.retryBaseDelay ?? 1000;
    this.cache = new LRUCache<string, CacheEntry>(this.maxCacheSize);
  }

  /**
   * 验证 slug 格式，防止 URL 注入
   * 只允许字母、数字、连字符和下划线
   */
  private validateSlug(slug: string): string {
    if (!slug || typeof slug !== "string") {
      throw new SecurityError("Slug is required");
    }

    // 长度限制
    if (slug.length > 128) {
      throw new SecurityError(`Slug too long: ${slug.length} > 128`);
    }

    // 格式验证：只允许字母、数字、连字符、下划线、斜杠（用于命名空间）
    const validPattern = /^[a-zA-Z0-9_/-]+$/;
    if (!validPattern.test(slug)) {
      throw new SecurityError(`Invalid slug format: ${slug}`);
    }

    // 防止路径遍历
    if (slug.includes("..") || slug.startsWith("/") || slug.endsWith("/")) {
      throw new SecurityError(`Invalid slug: ${slug}`);
    }

    return slug;
  }

  /**
   * 验证版本号格式
   */
  private validateVersion(version: string): string {
    // Semver 格式：major.minor.patch[-prerelease][+build]
    const semverPattern = /^(\d+)\.(\d+)\.(\d+)(?:-[\da-zA-Z-]+)?(?:\+[\da-zA-Z-]+)?$/;
    if (!semverPattern.test(version)) {
      throw new SecurityError(`Invalid version format: ${version}`);
    }
    return version;
  }

  /**
   * 构建安全的 URL
   */
  private buildUrl(path: string): string {
    // 使用 URL 构造器防止 URL 注入
    try {
      const baseUrl = new URL(this.config.registryUrl);
      // 确保路径以 / 开头但不以 / 结尾
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      return new URL(normalizedPath, baseUrl).toString();
    } catch (error) {
      throw new SecurityError(`Invalid URL construction: ${path}`);
    }
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 带重试的请求
   */
  private async requestWithRetry<T>(
    url: string,
    options?: RequestInit,
    retries = 0
  ): Promise<T> {
    try {
      return await this.doRequest<T>(url, options);
    } catch (error) {
      const isRetryable =
        error instanceof NetworkError &&
        error.retryable &&
        retries < this.maxRetries;

      if (isRetryable) {
        // 指数退避
        const delay = this.retryBaseDelay * Math.pow(2, retries);
        await this.delay(delay);
        return this.requestWithRetry<T>(url, options, retries + 1);
      }

      throw error;
    }
  }

  /**
   * 执行实际请求
   */
  private async doRequest<T>(url: string, options?: RequestInit): Promise<T> {
    const cacheKey = `${options?.method ?? "GET"}:${url}`;

    // 检查缓存 (仅 GET 请求)
    if (!options?.method || options.method === "GET") {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        return cached.data as T;
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.config.token) {
      headers["Authorization"] = `Bearer ${this.config.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...headers, ...options?.headers },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        // 4xx 错误不重试，5xx 错误可重试
        const retryable = response.status >= 500;
        throw new NetworkError(
          `API Error ${response.status}: ${errorText}`,
          response.status,
          retryable
        );
      }

      const data = await response.json();

      // 缓存 GET 响应
      if (!options?.method || options.method === "GET") {
        this.cache.set(cacheKey, {
          data,
          expires: Date.now() + this.cacheTTL,
          size: JSON.stringify(data).length,
        });
      }

      return data as T;
    } catch (error) {
      if (error instanceof NetworkError) {
        throw error;
      }
      // 网络错误可重试
      if (error instanceof Error) {
        throw new NetworkError(error.message, undefined, true);
      }
      throw new NetworkError("Unknown error", undefined, false);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 发送 API 请求
   */
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = this.buildUrl(path);
    return this.requestWithRetry<T>(url, options);
  }

  /**
   * 搜索技能
   */
  async search(params: SkillSearchParams): Promise<SkillSearchResult> {
    const query = new URLSearchParams();
    
    // 安全处理参数
    if (params.query) {
      // 限制查询长度
      const safeQuery = params.query.slice(0, 256);
      query.set("q", safeQuery);
    }
    if (params.tags?.length) {
      // 验证每个标签
      const safeTags = params.tags
        .slice(0, 10)
        .map((tag) => tag.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32));
      query.set("tags", safeTags.join(","));
    }
    if (params.author) {
      const safeAuthor = params.author.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
      query.set("author", safeAuthor);
    }
    if (params.limit) {
      const safeLimit = Math.min(Math.max(1, params.limit), 100);
      query.set("limit", String(safeLimit));
    }

    const response = await this.request<{
      entries: SkillRegistryEntry[];
      total: number;
      page: number;
      hasMore: boolean;
    }>(`/skills/search?${query.toString()}`);

    return response;
  }

  /**
   * 获取技能详情
   */
  async getSkill(slug: string): Promise<SkillRegistryEntry | null> {
    const safeSlug = this.validateSlug(slug);
    
    try {
      const response = await this.request<SkillRegistryEntry>(`/skills/${safeSlug}`);
      return response;
    } catch (error) {
      if (error instanceof NetworkError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 获取技能版本列表
   */
  async getVersions(slug: string): Promise<SkillVersion[]> {
    const safeSlug = this.validateSlug(slug);
    const response = await this.request<SkillVersion[]>(`/skills/${safeSlug}/versions`);
    return response;
  }

  /**
   * 获取特定版本的技能内容
   */
  async downloadSkill(slug: string, version?: string): Promise<{ files: Record<string, string>; version: string }> {
    const safeSlug = this.validateSlug(slug);
    const safeVersion = version ? this.validateVersion(version) : "";
    const versionPath = safeVersion ? `/${safeVersion}` : "";
    
    const response = await this.request<{ files: Record<string, string>; version: string }>(
      `/skills/${safeSlug}/download${versionPath}`
    );
    return response;
  }

  /**
   * 发布技能
   */
  async publishSkill(data: {
    slug: string;
    name: string;
    version: string;
    files: Record<string, string>;
    changelog?: string;
    tags?: string[];
  }): Promise<{ version: string; publishedAt: Date }> {
    const safeSlug = this.validateSlug(data.slug);
    const safeVersion = this.validateVersion(data.version);
    
    const response = await this.request<{ version: string; publishedAt: string }>("/skills/publish", {
      method: "POST",
      body: JSON.stringify({
        ...data,
        slug: safeSlug,
        version: safeVersion,
      }),
    });

    return {
      version: response.version,
      publishedAt: new Date(response.publishedAt),
    };
  }

  /**
   * 删除技能
   */
  async deleteSkill(slug: string): Promise<void> {
    const safeSlug = this.validateSlug(slug);
    await this.request(`/skills/${safeSlug}`, { method: "DELETE" });
  }

  /**
   * 获取用户的已发布技能
   */
  async getMySkills(): Promise<SkillRegistryEntry[]> {
    const response = await this.request<SkillRegistryEntry[]>("/user/skills");
    return response;
  }

  /**
   * 验证 API Token
   */
  async validateToken(): Promise<{ valid: boolean; username?: string }> {
    try {
      const response = await this.request<{ username: string }>("/user/me");
      return { valid: true, username: response.username };
    } catch {
      return { valid: false };
    }
  }

  /**
   * 设置认证 Token
   */
  setToken(token: string): void {
    this.config.token = token;
    this.cache.clear();
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
    };
  }

  /**
   * 获取当前配置 (不含敏感信息)
   */
  getConfig(): { registryUrl: string; siteUrl: string; timeout: number } {
    return {
      registryUrl: this.config.registryUrl,
      siteUrl: this.config.siteUrl,
      timeout: this.config.timeout,
    };
  }
}

/**
 * 创建 SkillRegistry 实例
 */
export function createSkillRegistry(config?: Partial<SkillRegistryConfig>): SkillRegistry {
  return new SkillRegistry(config);
}