/**
 * Git 集成类型定义
 *
 * 支持 GitHub、GitLab、Gitee 等平台
 */

/**
 * Git 平台类型
 */
export type GitPlatform = "github" | "gitlab" | "gitee" | "bitbucket";

/**
 * Git 集成配置
 */
export interface GitIntegrationConfig {
  /** 平台类型 */
  platform: GitPlatform;
  /** API 基础 URL */
  baseUrl?: string;
  /** 访问令牌 */
  token?: string;
  /** 用户名 */
  username?: string;
  /** 邮箱 */
  email?: string;
  /** 默认仓库 */
  defaultRepo?: string;
  /** 默认分支 */
  defaultBranch?: string;
  /** 请求超时（毫秒） */
  timeout: number;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_GIT_INTEGRATION_CONFIG: Omit<
  GitIntegrationConfig,
  "platform"
> = {
  timeout: 30000,
  defaultBranch: "main",
  enabled: true,
};

/**
 * 仓库信息
 */
export interface Repository {
  /** 仓库 ID */
  id: number | string;
  /** 仓库名称 */
  name: string;
  /** 完整名称（owner/repo） */
  fullName: string;
  /** 描述 */
  description: string | undefined;
  /** 是否私有 */
  private: boolean;
  /** 默认分支 */
  defaultBranch: string;
  /** HTTPS URL */
  htmlUrl: string;
  /** SSH URL */
  sshUrl: string | undefined;
  /** 克隆 URL */
  cloneUrl: string | undefined;
  /** 所有者 */
  owner: {
    login: string;
    avatarUrl: string | undefined;
  };
  /** 统计信息 */
  stats: {
    stars: number;
    forks: number;
    issues: number;
  } | undefined;
}

/**
 * Pull Request / Merge Request
 */
export interface PullRequest {
  /** PR ID */
  id: number | string;
  /** PR 编号 */
  number: number;
  /** 标题 */
  title: string;
  /** 描述 */
  body: string | undefined;
  /** 状态 */
  state: "open" | "closed" | "merged";
  /** 源分支 */
  sourceBranch: string;
  /** 目标分支 */
  targetBranch: string;
  /** 作者 */
  author: {
    login: string;
    avatarUrl: string | undefined;
  };
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string | undefined;
  /** 合并时间 */
  mergedAt: string | undefined;
  /** URL */
  htmlUrl: string;
  /** 是否可合并 */
  mergeable: boolean | undefined;
  /** 标签 */
  labels: string[] | undefined;
  /** 审查者 */
  reviewers: string[] | undefined;
}

/**
 * Issue
 */
export interface Issue {
  /** Issue ID */
  id: number | string;
  /** Issue 编号 */
  number: number;
  /** 标题 */
  title: string;
  /** 描述 */
  body: string | undefined;
  /** 状态 */
  state: "open" | "closed";
  /** 作者 */
  author: {
    login: string;
    avatarUrl: string | undefined;
  };
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string | undefined;
  /** URL */
  htmlUrl: string;
  /** 标签 */
  labels: string[] | undefined;
  /** 指派人 */
  assignees: string[] | undefined;
}

/**
 * 分支
 */
export interface Branch {
  /** 分支名 */
  name: string;
  /** 是否受保护 */
  protected: boolean;
  /** 最新提交 */
  commit: {
    sha: string;
    message: string;
    author: string;
    date: string;
  } | undefined;
}

/**
 * 提交
 */
export interface Commit {
  /** SHA */
  sha: string;
  /** 短 SHA */
  shortSha: string;
  /** 提交信息 */
  message: string;
  /** 作者 */
  author: {
    name: string;
    email: string;
    date: string;
  };
  /** 提交者 */
  committer: {
    name: string;
    email: string;
    date: string;
  } | undefined;
  /** 父提交 */
  parents: string[] | undefined;
  /** URL */
  htmlUrl: string | undefined;
}

/**
 * 创建 PR 选项
 */
export interface CreatePROptions {
  /** 标题 */
  title: string;
  /** 描述 */
  body?: string;
  /** 源分支 */
  sourceBranch: string;
  /** 目标分支 */
  targetBranch?: string;
  /** 是否草稿 */
  draft?: boolean;
  /** 标签 */
  labels?: string[];
  /** 审查者 */
  reviewers?: string[];
}

/**
 * 创建 Issue 选项
 */
export interface CreateIssueOptions {
  /** 标题 */
  title: string;
  /** 描述 */
  body?: string;
  /** 标签 */
  labels?: string[];
  /** 指派人 */
  assignees?: string[];
  /** 里程碑 */
  milestone?: number | string;
}

/**
 * Git 操作结果
 */
export interface GitOperationResult<T> {
  /** 是否成功 */
  success: boolean;
  /** 结果数据 */
  data?: T;
  /** 错误信息 */
  error?: string;
  /** 错误详情 */
  details?: unknown;
}
