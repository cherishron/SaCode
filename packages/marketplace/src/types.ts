/**
 * Marketplace 类型定义
 */

/**
 * 发布平台
 */
export enum Platform {
  VSCode = "vscode",
  OpenVSX = "openvsx",
  NPM = "npm",
  Docker = "docker",
}

/**
 * 发布配置
 */
export interface PublishConfig {
  /** 包名称 */
  name: string;
  /** 发布者 */
  publisher: string;
  /** 版本号 */
  version: string;
  /** 目标平台 */
  platforms: Platform[];
  /** 发布说明 */
  releaseNotes?: string;
  /** 是否为预发布版本 */
  prerelease?: boolean;
  /** 发布标签 (latest, beta, etc.) */
  tag?: string;
}

/**
 * 发布选项
 */
export interface PublishOptions {
  /** 是否跳过构建 */
  skipBuild?: boolean;
  /** 是否跳过测试 */
  skipTests?: boolean;
  /** 是否立即发布 */
  publishImmediately?: boolean;
  /** 工作目录 */
  cwd?: string;
}

/**
 * 发布结果
 */
export interface PublishResult {
  /** 发布平台 */
  platform: Platform;
  /** 是否成功 */
  success: boolean;
  /** 发布 URL */
  url?: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 插件信息
 */
export interface ExtensionInfo {
  /** 扩展 ID */
  id: string;
  /** 扩展名称 */
  name: string;
  /** 显示名称 */
  displayName: string;
  /** 描述 */
  description: string;
  /** 版本 */
  version: string;
  /** 发布者 */
  publisher: string;
  /** 分类 */
  categories: string[];
  /** 关键词 */
  keywords?: string[];
  /** 图标 */
  icon?: string;
  /** 主页 */
  homepage?: string;
  /** 仓库 */
  repository?: string;
  /** Bug 追踪 */
  bugs?: string;
  /** 许可证 */
  license: string;
}