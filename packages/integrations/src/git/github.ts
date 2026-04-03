/**
 * GitHub 集成客户端
 *
 * 提供 GitHub API 操作封装
 */

import type {
  GitIntegrationConfig,
  Repository,
  PullRequest,
  Issue,
  Branch,
  Commit,
  CreatePROptions,
  CreateIssueOptions,
  GitOperationResult,
} from "./types";
import { DEFAULT_GIT_INTEGRATION_CONFIG } from "./types";

/**
 * GitHub API 响应类型
 */
interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description?: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  ssh_url?: string;
  clone_url?: string;
  owner: {
    login: string;
    avatar_url?: string;
  };
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
}

interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: string;
  head: { ref: string };
  base: { ref: string };
  user: {
    login: string;
    avatar_url?: string;
  };
  created_at: string;
  updated_at?: string;
  merged_at?: string;
  html_url: string;
  mergeable?: boolean;
  labels?: Array<{ name: string }>;
  requested_reviewers?: Array<{ login: string }>;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: string;
  user: {
    login: string;
    avatar_url?: string;
  };
  created_at: string;
  updated_at?: string;
  html_url: string;
  labels?: Array<{ name: string }>;
  assignees?: Array<{ login: string }>;
}

interface GitHubBranch {
  name: string;
  protected: boolean;
  commit?: {
    sha: string;
    commit: {
      message: string;
      author: {
        name: string;
        date: string;
      };
    };
  };
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer?: {
      name: string;
      email: string;
      date: string;
    };
  };
  parents?: Array<{ sha: string }>;
  html_url?: string;
}

/**
 * GitHub 客户端
 *
 * @example
 * ```typescript
 * const github = new GitHubClient({
 *   token: process.env.GITHUB_TOKEN,
 *   defaultRepo: "owner/repo",
 * });
 *
 * // 创建 PR
 * const pr = await github.createPR({
 *   title: "feat: add new feature",
 *   sourceBranch: "feature/new-feature",
 *   targetBranch: "main",
 * });
 * ```
 */
export class GitHubClient {
  private config: GitIntegrationConfig;
  private baseUrl: string;

  constructor(config: Partial<GitIntegrationConfig> & { token?: string }) {
    this.config = {
      ...DEFAULT_GIT_INTEGRATION_CONFIG,
      ...config,
      platform: "github",
    };
    this.baseUrl = this.config.baseUrl ?? "https://api.github.com";
  }

  /**
   * 解析仓库名称
   */
  private parseRepoName(repo?: string): { owner: string; repo: string } {
    const fullName = repo ?? this.config.defaultRepo;
    if (!fullName) {
      throw new Error("Repository name is required");
    }

    const [owner, repoName] = fullName.split("/");
    if (!owner || !repoName) {
      throw new Error(`Invalid repository name: ${fullName}`);
    }

    return { owner, repo: repoName };
  }

  /**
   * 发送 API 请求
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    const options: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * 获取仓库信息
   */
  async getRepository(repo?: string): Promise<GitOperationResult<Repository>> {
    try {
      const { owner, repo: repoName } = this.parseRepoName(repo);
      const data = await this.request<GitHubRepository>(
        "GET",
        `/repos/${owner}/${repoName}`
      );

      return {
        success: true,
        data: this.mapRepository(data),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 列出仓库分支
   */
  async listBranches(repo?: string): Promise<GitOperationResult<Branch[]>> {
    try {
      const { owner, repo: repoName } = this.parseRepoName(repo);
      const data = await this.request<GitHubBranch[]>(
        "GET",
        `/repos/${owner}/${repoName}/branches`
      );

      return {
        success: true,
        data: data.map((b) => this.mapBranch(b)),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 列出 Pull Requests
   */
  async listPRs(
    options?: {
      state?: "open" | "closed" | "all";
      limit?: number;
    },
    repo?: string
  ): Promise<GitOperationResult<PullRequest[]>> {
    try {
      const { owner, repo: repoName } = this.parseRepoName(repo);
      const params = new URLSearchParams();
      params.set("state", options?.state ?? "open");
      if (options?.limit) {
        params.set("per_page", String(options.limit));
      }

      const data = await this.request<GitHubPullRequest[]>(
        "GET",
        `/repos/${owner}/${repoName}/pulls?${params}`
      );

      return {
        success: true,
        data: data.map((pr) => this.mapPR(pr)),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 创建 Pull Request
   */
  async createPR(
    options: CreatePROptions,
    repo?: string
  ): Promise<GitOperationResult<PullRequest>> {
    try {
      const { owner, repo: repoName } = this.parseRepoName(repo);
      const data = await this.request<GitHubPullRequest>(
        "POST",
        `/repos/${owner}/${repoName}/pulls`,
        {
          title: options.title,
          body: options.body,
          head: options.sourceBranch,
          base: options.targetBranch ?? this.config.defaultBranch ?? "main",
          draft: options.draft,
        }
      );

      // 添加标签
      if (options.labels && options.labels.length > 0) {
        await this.request(
          "POST",
          `/repos/${owner}/${repoName}/issues/${data.number}/labels`,
          { labels: options.labels }
        );
      }

      // 添加审查者
      if (options.reviewers && options.reviewers.length > 0) {
        await this.request(
          "POST",
          `/repos/${owner}/${repoName}/pulls/${data.number}/requested_reviewers`,
          { reviewers: options.reviewers }
        );
      }

      return {
        success: true,
        data: this.mapPR(data),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 列出 Issues
   */
  async listIssues(
    options?: {
      state?: "open" | "closed" | "all";
      labels?: string[];
      limit?: number;
    },
    repo?: string
  ): Promise<GitOperationResult<Issue[]>> {
    try {
      const { owner, repo: repoName } = this.parseRepoName(repo);
      const params = new URLSearchParams();
      params.set("state", options?.state ?? "open");
      if (options?.labels) {
        params.set("labels", options.labels.join(","));
      }
      if (options?.limit) {
        params.set("per_page", String(options.limit));
      }

      const data = await this.request<GitHubIssue[]>(
        "GET",
        `/repos/${owner}/${repoName}/issues?${params}`
      );

      return {
        success: true,
        data: data.filter((i) => !("pull_request" in i)).map((issue) => this.mapIssue(issue)),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 创建 Issue
   */
  async createIssue(
    options: CreateIssueOptions,
    repo?: string
  ): Promise<GitOperationResult<Issue>> {
    try {
      const { owner, repo: repoName } = this.parseRepoName(repo);
      const data = await this.request<GitHubIssue>(
        "POST",
        `/repos/${owner}/${repoName}/issues`,
        {
          title: options.title,
          body: options.body,
          labels: options.labels,
          assignees: options.assignees,
          milestone: options.milestone,
        }
      );

      return {
        success: true,
        data: this.mapIssue(data),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取提交信息
   */
  async getCommit(
    sha: string,
    repo?: string
  ): Promise<GitOperationResult<Commit>> {
    try {
      const { owner, repo: repoName } = this.parseRepoName(repo);
      const data = await this.request<GitHubCommit>(
        "GET",
        `/repos/${owner}/${repoName}/commits/${sha}`
      );

      return {
        success: true,
        data: this.mapCommit(data),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // 映射函数

  private mapRepository(data: GitHubRepository): Repository {
    return {
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      private: data.private,
      defaultBranch: data.default_branch,
      htmlUrl: data.html_url,
      sshUrl: data.ssh_url,
      cloneUrl: data.clone_url,
      owner: {
        login: data.owner.login,
        avatarUrl: data.owner.avatar_url,
      },
      stats: {
        stars: data.stargazers_count ?? 0,
        forks: data.forks_count ?? 0,
        issues: data.open_issues_count ?? 0,
      },
    };
  }

  private mapPR(data: GitHubPullRequest): PullRequest {
    return {
      id: data.id,
      number: data.number,
      title: data.title,
      body: data.body,
      state: data.merged_at ? "merged" : (data.state as "open" | "closed"),
      sourceBranch: data.head.ref,
      targetBranch: data.base.ref,
      author: {
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      mergedAt: data.merged_at,
      htmlUrl: data.html_url,
      mergeable: data.mergeable,
      labels: data.labels?.map((l) => l.name),
      reviewers: data.requested_reviewers?.map((r) => r.login),
    };
  }

  private mapIssue(data: GitHubIssue): Issue {
    return {
      id: data.id,
      number: data.number,
      title: data.title,
      body: data.body,
      state: data.state as "open" | "closed",
      author: {
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      htmlUrl: data.html_url,
      labels: data.labels?.map((l) => l.name),
      assignees: data.assignees?.map((a) => a.login),
    };
  }

  private mapBranch(data: GitHubBranch): Branch {
    return {
      name: data.name,
      protected: data.protected,
      commit: data.commit ? {
        sha: data.commit.sha,
        message: data.commit.commit.message,
        author: data.commit.commit.author.name,
        date: data.commit.commit.author.date,
      } : undefined,
    };
  }

  private mapCommit(data: GitHubCommit): Commit {
    return {
      sha: data.sha,
      shortSha: data.sha.slice(0, 7),
      message: data.commit.message,
      author: data.commit.author,
      committer: data.commit.committer,
      parents: data.parents?.map((p) => p.sha),
      htmlUrl: data.html_url,
    };
  }
}

/**
 * 创建 GitHub 客户端实例
 */
export function createGitHubClient(
  config?: Partial<GitIntegrationConfig> & { token?: string }
): GitHubClient {
  return new GitHubClient(config ?? {});
}
