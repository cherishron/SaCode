/**
 * SkillHub 适配器
 *
 * SkillHub 是 ClawHub 的国内镜像站，由腾讯云托管。
 * 提供以下优势：
 * - 国内高速下载（腾讯云 COS 镜像）
 * - 解决 ClawHub 限频问题
 * - 中文界面支持
 *
 * @see https://skillhub.tencent.com/
 */

import {
  SkillRegistry,
  DEFAULT_SKILLHUB_CONFIG,
  NetworkError,
} from "../registry";
import type { SkillRegistryConfig } from "../registry";
import type { SkillRegistryEntry, SkillSearchResult, SkillVersion } from "../types";

/**
 * SkillHub 特定配置
 */
export interface SkillHubConfig extends SkillRegistryConfig {
  /** 是否使用腾讯云 COS 镜像加速下载 */
  useCOSMirror?: boolean;
  /** 腾讯云 COS 基础 URL（可选，默认自动检测） */
  cosBaseUrl?: string;
}

/**
 * COS 下载响应类型
 */
interface COSPackageResponse {
  files?: Record<string, string>;
  version?: string;
}

/**
 * SkillHub 适配器
 *
 * 继承自 SkillRegistry，针对腾讯云 SkillHub 进行优化：
 * - 自动使用腾讯云 COS 镜像加速下载
 * - 支持国内网络环境优化
 *
 * @example
 * ```typescript
 * // 使用默认 SkillHub 配置
 * const adapter = new SkillHubAdapter();
 *
 * // 或自定义配置
 * const adapter = new SkillHubAdapter({
 *   timeout: 60000,
 *   useCOSMirror: true,
 * });
 *
 * // 搜索技能
 * const results = await adapter.search({ query: "calendar" });
 *
 * // 安装技能
 * const skill = await adapter.downloadSkill("my-skill");
 * ```
 */
export class SkillHubAdapter extends SkillRegistry {
  private readonly useCOSMirror: boolean;
  private readonly cosBaseUrl: string;

  constructor(config?: Partial<SkillHubConfig>) {
    super({
      ...DEFAULT_SKILLHUB_CONFIG,
      ...config,
    });
    this.useCOSMirror = config?.useCOSMirror ?? true;
    this.cosBaseUrl = config?.cosBaseUrl ?? "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com";
  }

  /**
   * 获取当前注册表类型
   */
  get registryType(): "skillhub" {
    return "skillhub";
  }

  /**
   * 获取 COS 镜像地址
   *
   * 腾讯云 COS 地址格式：
   * https://skillhub-{bucket}.cos.ap-guangzhou.myqcloud.com/
   */
  private getCOSUrl(): string {
    return this.cosBaseUrl;
  }

  /**
   * 搜索技能
   *
   * SkillHub 搜索支持：
   * - 关键词搜索
   * - 标签过滤
   * - 作者过滤
   */
  override async search(params: {
    query?: string;
    tags?: string[];
    author?: string;
    limit?: number;
    page?: number;
  }): Promise<SkillSearchResult> {
    return super.search(params);
  }

  /**
   * 获取技能详情
   */
  override async getSkill(slug: string): Promise<SkillRegistryEntry | null> {
    return super.getSkill(slug);
  }

  /**
   * 获取技能版本列表
   */
  override async getVersions(slug: string): Promise<SkillVersion[]> {
    return super.getVersions(slug);
  }

  /**
   * 下载技能
   *
   * 如果启用 COS 镜像，会优先从腾讯云 COS 下载以获得更快的速度
   */
  override async downloadSkill(
    slug: string,
    version?: string
  ): Promise<{ files: Record<string, string>; version: string }> {
    // 先尝试使用 SkillHub API
    try {
      const result = await super.downloadSkill(slug, version);
      return result;
    } catch (error) {
      // 如果 API 失败且启用了 COS 镜像，尝试从 COS 直接下载
      if (this.useCOSMirror && error instanceof NetworkError) {
        return this.downloadFromCOS(slug, version);
      }
      throw error;
    }
  }

  /**
   * 从腾讯云 COS 直接下载技能
   *
   * 这是一个备用方案，当 API 不可用时使用
   */
  private async downloadFromCOS(
    slug: string,
    version?: string
  ): Promise<{ files: Record<string, string>; version: string }> {
    const cosUrl = this.getCOSUrl();
    const versionPath = version ? `/v${version}` : "/latest";
    const url = `${cosUrl}/skills/${slug}${versionPath}/package.json`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new NetworkError(
          `COS download failed: ${response.status}`,
          response.status,
          false
        );
      }

      const data = (await response.json()) as COSPackageResponse;
      return {
        files: data.files ?? {},
        version: data.version ?? version ?? "latest",
      };
    } catch (error) {
      if (error instanceof NetworkError) {
        throw error;
      }
      throw new NetworkError(
        `Failed to download from COS: ${error}`,
        undefined,
        true
      );
    }
  }

  /**
   * 获取配置信息
   */
  override getConfig(): {
    registryUrl: string;
    siteUrl: string;
    timeout: number;
    useCOSMirror: boolean;
    registryType: "skillhub";
  } {
    const baseConfig = super.getConfig();
    return {
      ...baseConfig,
      useCOSMirror: this.useCOSMirror,
      registryType: "skillhub",
    };
  }
}

/**
 * 创建 SkillHub 适配器实例
 */
export function createSkillHubAdapter(
  config?: Partial<SkillHubConfig>
): SkillHubAdapter {
  return new SkillHubAdapter(config);
}