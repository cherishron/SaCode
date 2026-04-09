/**
 * 内置工具集 — Claude Code 风格
 *
 * 提供两种使用方式：
 * 1. createDefaultTools(rootDir) — 工厂函数，推荐用法
 * 2. builtinTools — 向后兼容，使用 process.cwd()
 */

import { createFileReadTool, fileReadTool } from "./file-read.js";
import { createFileWriteTool, fileWriteTool } from "./file-write.js";
import { createFileSearchTool, fileSearchTool } from "./file-search.js";
import { createShellExecTool, shellExecTool } from "./shell-exec.js";
import { createCodeSearchTool, codeSearchTool } from "./code-search.js";
import { createDiffApplyTool, diffApplyTool } from "./diff-apply.js";
import type { Tool } from "../agent/types.js";

/**
 * 创建完整的内置工具集（推荐）
 * @param rootDir 项目根目录，所有相对路径基于此目录解析
 */
export function createDefaultTools(rootDir: string): Tool[] {
  return [
    createFileReadTool(rootDir),
    createFileWriteTool(rootDir),
    createFileSearchTool(rootDir),
    createShellExecTool(rootDir),
    createCodeSearchTool(rootDir),
    createDiffApplyTool(rootDir),
  ];
}

/** 向后兼容：使用 process.cwd() 的工具实例 */
export const builtinTools: Tool[] = [
  fileReadTool,
  fileWriteTool,
  fileSearchTool,
  shellExecTool,
  codeSearchTool,
  diffApplyTool,
];

// 导出工厂函数
export {
  createFileReadTool,
  createFileWriteTool,
  createFileSearchTool,
  createShellExecTool,
  createCodeSearchTool,
  createDiffApplyTool,
};

// 导出向后兼容的实例
export {
  fileReadTool,
  fileWriteTool,
  fileSearchTool,
  shellExecTool,
  codeSearchTool,
  diffApplyTool,
};
