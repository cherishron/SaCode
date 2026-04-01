import { z } from "zod";

// ============================================================================
// 工具定义
// ============================================================================

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
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
}
