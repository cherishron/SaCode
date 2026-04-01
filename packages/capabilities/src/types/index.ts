import { z } from "zod";

// ============================================================================
// 工具定义
// ============================================================================

export interface InputSchemaParser<TInput = unknown> {
  parse: (input: unknown) => TInput;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: InputSchemaParser<TInput> | z.ZodType<TInput>;
  execute: (input: unknown) => Promise<TOutput>;
}

export interface ToolRegistry {
  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  execute(name: string, input: unknown): Promise<unknown>;
}

// ============================================================================
// 文件工具类型
// ============================================================================

export const ReadFileInputSchema = z.object({
  path: z.string().describe("文件绝对路径"),
  limit: z.number().optional().describe("最大读取行数"),
  offset: z.number().optional().describe("起始行偏移"),
});

export const WriteFileInputSchema = z.object({
  path: z.string().describe("文件绝对路径"),
  content: z.string().describe("文件内容"),
});

export const ListDirectoryInputSchema = z.object({
  path: z.string().describe("目录绝对路径"),
  recursive: z.boolean().optional().describe("是否递归列出"),
});

export const SearchFilesInputSchema = z.object({
  pattern: z.string().describe("搜索模式 (glob)"),
  path: z.string().optional().describe("搜索路径"),
});

export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;
export type WriteFileInput = z.infer<typeof WriteFileInputSchema>;
export type ListDirectoryInput = z.infer<typeof ListDirectoryInputSchema>;
export type SearchFilesInput = z.infer<typeof SearchFilesInputSchema>;

export interface EditFileInput {
  path: string;
  edits: Array<{
    type: "line" | "regex" | "string";
    oldText?: string;
    newText: string;
    startLine?: number;
    endLine?: number;
    regex?: string;
    flags?: string;
  }>;
  createBackup?: boolean;
  dryRun?: boolean;
}

export interface DeleteFileInput {
  path: string;
  recursive?: boolean;
  force?: boolean;
  moveToTrash?: boolean;
}

// ============================================================================
// 浏览器工具类型
// ============================================================================

export const BrowserNavigateInputSchema = z.object({
  url: z.string().url().describe("目标 URL"),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle0"]).optional(),
});

export const BrowserClickInputSchema = z.object({
  selector: z.string().describe("CSS 选择器"),
  timeout: z.number().optional().describe("超时时间 (ms)"),
});

export const BrowserTypeInputSchema = z.object({
  selector: z.string().describe("CSS 选择器"),
  text: z.string().describe("输入文本"),
  delay: z.number().optional().describe("输入延迟 (ms)"),
});

export const BrowserScreenshotInputSchema = z.object({
  fullPage: z.boolean().optional().describe("是否全页面截图"),
  selector: z.string().optional().describe("特定元素选择器"),
});

export const BrowserExtractInputSchema = z.object({
  selector: z.string().describe("CSS 选择器"),
  attribute: z.string().optional().describe("要提取的属性"),
});

export type BrowserNavigateInput = z.infer<typeof BrowserNavigateInputSchema>;
export type BrowserClickInput = z.infer<typeof BrowserClickInputSchema>;
export type BrowserTypeInput = z.infer<typeof BrowserTypeInputSchema>;
export type BrowserScreenshotInput = z.infer<typeof BrowserScreenshotInputSchema>;
export type BrowserExtractInput = z.infer<typeof BrowserExtractInputSchema>;

// ============================================================================
// Shell 工具类型
// ============================================================================

export const ExecuteCommandInputSchema = z.object({
  command: z.string().describe("要执行的命令"),
  cwd: z.string().optional().describe("工作目录"),
  timeout: z.number().optional().describe("超时时间 (ms)"),
  env: z.record(z.string()).optional().describe("环境变量"),
});

export type ExecuteCommandInput = z.infer<typeof ExecuteCommandInputSchema>;

export interface ExecuteCommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

// ============================================================================
// 环境检测类型
// ============================================================================

export interface RuntimeInfo {
  /** 运行时名称 (python, node, etc.) */
  name: string;
  /** 是否已安装 */
  installed: boolean;
  /** 版本号 */
  version?: string | undefined;
  /** 安装路径 */
  path?: string | undefined;
}

export interface VfoxInfo {
  /** 是否已安装 vfox */
  installed: boolean;
  /** vfox 版本 */
  version?: string | undefined;
  /** vfox 可执行文件路径 */
  path?: string | undefined;
}

// ============================================================================
// 配置类型
// ============================================================================

export interface FilesCapabilityConfig {
  enabled: boolean;
  allowedDirs: string[];
  maxSize: number;
  readOnly: boolean;
}

export interface BrowserCapabilityConfig {
  enabled: boolean;
  headless: boolean;
  timeout: number;
}

export interface ShellCapabilityConfig {
  enabled: boolean;
  allowedCommands: string[];
  timeout: number;
  /** 是否启用 vfox 集成 */
  useVfox: boolean;
  /** vfox 管理的 SDK 列表（用于自动使用 vfox exec） */
  vfoxSdks: string[];
}

export interface CapabilitiesConfig {
  files: FilesCapabilityConfig;
  browser: BrowserCapabilityConfig;
  shell: ShellCapabilityConfig;
  web: WebCapabilityConfig;
}

// ============================================================================
// Web 工具类型
// ============================================================================

export interface WebSearchInput {
  query: string;
  numResults?: number;
  language?: string;
  region?: string;
  timeRange?: "d" | "w" | "m" | "y";
}

export interface WebSearchResult {
  query: string;
  results: Array<{
    title: string;
    url: string;
    snippet?: string;
  }>;
  abstract: string | null;
  abstractUrl: string | null;
  relatedTopics: Array<{
    title: string;
    url: string;
  }>;
}

export interface WebSearchConfig {
  enabled: boolean;
  apiProvider?: "duckduckgo" | "google" | "bing";
  timeout?: number;
}

export interface WebFetchInput {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  followRedirects?: boolean;
}

export interface WebFetchConfig {
  enabled: boolean;
  defaultTimeout?: number;
}

export interface HttpRequestInput {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  timeout?: number;
  followRedirects?: boolean;
}

export interface HttpRequestConfig {
  enabled: boolean;
  defaultTimeout?: number;
  maxRedirects?: number;
}

export interface WebCapabilityConfig {
  enabled: boolean;
  search?: WebSearchConfig;
  fetch?: WebFetchConfig;
  http?: HttpRequestConfig;
}

// ============================================================================
// 代码搜索类型
// ============================================================================

export interface GrepToolInput {
  pattern: string;
  path?: string;
  caseSensitive?: boolean;
  contextLines?: number;
  filePattern?: string;
  excludePatterns?: string[];
  maxResults?: number;
  ignoreHidden?: boolean;
}

export interface GrepToolResult {
  matches: Array<{
    file: string;
    lineNumber: number;
    line: string;
    contextBefore: string[];
    contextAfter: string[];
  }>;
  totalMatches: number;
  filesSearched: number;
}

export interface SearchCapabilityConfig {
  enabled: boolean;
  useRipgrep?: boolean;
  maxResults?: number;
  timeout?: number;
}

export interface CapabilitiesConfig {
  files: FilesCapabilityConfig;
  browser: BrowserCapabilityConfig;
  shell: ShellCapabilityConfig;
  web: WebCapabilityConfig;
  search?: SearchCapabilityConfig;
  lsp?: LspCapabilityConfig;
  task?: TaskCapabilityConfig;
  agent?: AgentCapabilityConfig;
  git?: GitCapabilityConfig;
}

// ============================================================================
// Git Worktree 类型
// ============================================================================

export interface EnterWorktreeInput {
  branch: string;
  path?: string;
  createIfNotExists?: boolean;
  checkout?: boolean;
}

export interface ExitWorktreeInput {
  path?: string;
  remove?: boolean;
  force?: boolean;
  moveToMain?: boolean;
}

export interface GitCapabilityConfig {
  enabled: boolean;
  defaultPath?: string;
}

// ============================================================================
// Agent 管理类型
// ============================================================================

export interface AgentToolInput {
  agentName: string;
  task: string;
  context?: Record<string, unknown>;
  tools?: string[];
  model?: string;
}

export interface TeamCreateInput {
  teamName: string;
  agents: Array<{
    name: string;
    role: string;
    model?: string;
    tools?: string[];
  }>;
  coordinationMode?: "sequential" | "parallel" | "hierarchical";
}

export interface TeamDeleteInput {
  teamName: string;
}

export interface AgentCapabilityConfig {
  enabled: boolean;
  maxAgents?: number;
  maxTeams?: number;
}

// ============================================================================
// 任务管理类型
// ============================================================================

export interface TaskCreateInput {
  name: string;
  type: "interval" | "once" | "cron";
  config: {
    interval?: number;
    executeAt?: string;
    cronExpression?: string;
  };
  message: string;
  channel: string;
  chatId: string;
  enabled?: boolean;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

export interface TaskUpdateInput {
  taskId: string;
  name?: string;
  message?: string;
  enabled?: boolean;
  config?: {
    interval?: number;
    executeAt?: string;
    cronExpression?: string;
  };
}

export interface TaskCapabilityConfig {
  enabled: boolean;
  maxTasks?: number;
}

// ============================================================================
// LSP 工具类型
// ============================================================================

export interface LspToolInput {
  action: "definition" | "references" | "completion" | "diagnostics" | "symbols" | "format" | "rename";
  uri: string;
  position?: {
    line: number;
    character: number;
  };
  language?: string;
  newName?: string;
  query?: string;
}

export interface LspToolResult {
  action: string;
  uri: string;
  result?: unknown;
  error?: string;
}

export interface LspCapabilityConfig {
  enabled: boolean;
  languageServers?: Record<string, {
    command: string;
    args?: string[];
    rootPatterns?: string[];
  }>;
  timeout?: number;
}
