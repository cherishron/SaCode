import { z } from "zod";

/**
 * Skill 定义 Schema (ClawHub 兼容)
 */
export const SkillSchema = z.object({
  /** Skill 名称 */
  name: z.string().min(1),
  /** 唯一标识符 (slug) */
  slug: z.string().optional(),
  /** 描述 */
  description: z.string().optional(),
  /** 使用指南 */
  instructions: z.string(),
  /** 可用工具列表 */
  tools: z.array(z.string()).optional(),
  /** 是否启用 */
  enabled: z.boolean().default(true),
  /** 版本号 */
  version: z.string().default("1.0.0"),
  /** 标签 */
  tags: z.array(z.string()).optional(),
  /** 作者 */
  author: z.string().optional(),
  /** 主页 URL */
  homepage: z.string().url().optional(),
  /** 仓库 URL */
  repository: z.string().url().optional(),
  /** 依赖的其他 Skills */
  dependencies: z.array(z.string()).optional(),
  /** 配置要求 */
  config: z
    .object({
      env: z.array(z.string()).optional(),
      files: z.array(z.string()).optional(),
    })
    .optional(),
});

export type Skill = z.infer<typeof SkillSchema>;

/**
 * Skill 版本信息
 */
export interface SkillVersion {
  version: string;
  changelog?: string;
  publishedAt: Date;
  tags: string[];
}

/**
 * Skill 注册表条目
 */
export interface SkillRegistryEntry {
  slug: string;
  name: string;
  description?: string;
  author?: string;
  latestVersion: string;
  versions: SkillVersion[];
  tags: string[];
  stars: number;
  installs: number;
  publishedAt: Date;
  updatedAt: Date;
}

/**
 * Skill 加载结果
 */
export interface SkillLoadResult {
  skill: Skill;
  path: string;
  loadedAt: Date;
  error?: string;
}

/**
 * Skill 加载器配置
 */
export interface SkillLoaderOptions {
  /** Skills 目录路径 */
  skillsDir: string;
  /** 是否递归加载子目录 */
  recursive: boolean;
  /** Skill 文件名 */
  skillFileName: string;
  /** 是否自动发现 */
  autoDiscover: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_SKILL_LOADER_OPTIONS: SkillLoaderOptions = {
  skillsDir: ".SACODE/skills",
  recursive: true,
  skillFileName: "SKILL.md",
  autoDiscover: true,
};

/**
 * Skill 发现事件
 */
export interface SkillDiscoveryEvent {
  type: "discovered" | "loaded" | "error" | "removed";
  skillName: string;
  path: string;
  timestamp: Date;
  error?: string;
}

/**
 * Skill 安装配置
 */
export interface SkillInstallOptions {
  /** 目标目录 */
  targetDir: string;
  /** 是否覆盖已存在 */
  force: boolean;
  /** 指定版本 */
  version?: string;
  /** 安装后是否启用 */
  enable: boolean;
}

/**
 * Skill 搜索参数
 */
export interface SkillSearchParams {
  /** 搜索关键词 */
  query?: string;
  /** 标签过滤 */
  tags?: string[];
  /** 作者过滤 */
  author?: string;
  /** 结果数量限制 */
  limit?: number;
}

/**
 * Skill 搜索结果
 */
export interface SkillSearchResult {
  entries: SkillRegistryEntry[];
  total: number;
  page: number;
  hasMore: boolean;
}

/**
 * ClawHub 注册中心配置
 */
export interface ClawHubConfig {
  /** API 基础 URL */
  registryUrl: string;
  /** 站点 URL */
  siteUrl: string;
  /** API Token */
  token?: string;
  /** 请求超时 (毫秒) */
  timeout: number;
}

/**
 * Skill 锁文件条目
 */
export interface SkillLockEntry {
  slug: string;
  version: string;
  installedAt: Date;
  path: string;
  checksum: string;
}

/**
 * Skill 锁文件
 */
export interface SkillLockfile {
  version: number;
  updatedAt: Date;
  skills: SkillLockEntry[];
}