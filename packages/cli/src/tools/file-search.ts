/**
 * file_search 工具 — 文件搜索（glob 模式 + 内容 grep）
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import type { Tool, ToolResult } from "../agent/types.js";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".cache",
  "coverage",
  ".turbo",
  "__pycache__",
]);
const MAX_FILE_SIZE = 100_000; // 100KB
const DEFAULT_MAX_RESULTS = 50;

export function createFileSearchTool(rootDir: string): Tool {
  return {
    name: "file_search",
    description:
      "Search for files by name pattern (glob-like) and/or search for text content within files (grep-like). Supports combined filtering.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "File name pattern (e.g. '*.ts', 'config.*', '*.test.ts')",
        },
        contentMatch: {
          type: "string",
          description: "Text or regex to search within file contents",
        },
        directory: {
          type: "string",
          description: "Directory to search in (default: project root)",
        },
        maxResults: {
          type: "number",
          description: `Maximum results to return (default: ${DEFAULT_MAX_RESULTS})`,
        },
      },
    },
    requiresApproval: false,

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const searchDir = args.directory
        ? resolve(rootDir, String(args.directory))
        : rootDir;
      const maxResults = Number(args.maxResults) || DEFAULT_MAX_RESULTS;
      const results: string[] = [];

      // 编译文件名匹配模式
      let nameRegex: RegExp | null = null;
      if (args.pattern) {
        const pattern = String(args.pattern)
          .replace(/\./g, "\\.")
          .replace(/\*\*/g, "{{GLOBSTAR}}")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, ".")
          .replace(/\{\{GLOBSTAR\}\}/g, ".*");
        nameRegex = new RegExp(`^${pattern}$`, "i");
      }

      // 编译内容搜索模式
      let contentRegex: RegExp | null = null;
      if (args.contentMatch) {
        try {
          contentRegex = new RegExp(String(args.contentMatch), "gi");
        } catch {
          // 如果不是有效正则，当作纯文本
          contentRegex = new RegExp(
            String(args.contentMatch).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "gi",
          );
        }
      }

      function walk(dir: string): void {
        if (results.length >= maxResults) return;
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (results.length >= maxResults) break;
            if (IGNORE_DIRS.has(entry.name)) continue;
            if (entry.name.startsWith(".") && entry.isDirectory()) continue;

            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(fullPath);
            } else {
              const relPath = relative(rootDir, fullPath);

              // 文件名匹配
              const nameMatches = nameRegex
                ? nameRegex.test(entry.name)
                : true;
              if (!nameMatches) continue;

              // 如果没有内容搜索且文件名匹配，直接添加
              if (!contentRegex) {
                if (nameRegex) results.push(relPath);
                continue;
              }

              // 内容搜索
              try {
                const stat = statSync(fullPath);
                if (stat.size > MAX_FILE_SIZE) continue;
                const fileContent = readFileSync(fullPath, "utf-8");
                const lines = fileContent.split("\n");
                const matchLines: string[] = [];

                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i]!;
                  contentRegex.lastIndex = 0;
                  if (contentRegex.test(line)) {
                    matchLines.push(
                      `  L${i + 1}: ${line.trim().slice(0, 120)}`,
                    );
                  }
                }

                if (matchLines.length > 0) {
                  results.push(
                    `${relPath}\n${matchLines.slice(0, 5).join("\n")}`,
                  );
                }
              } catch {
                /* skip unreadable files */
              }
            }
          }
        } catch {
          /* permission error */
        }
      }

      walk(searchDir);

      const output =
        results.length > 0
          ? `Found ${results.length} result(s):\n\n${results.join("\n")}`
          : "No matches found.";

      return {
        success: true,
        output,
        metadata: { count: results.length },
      };
    },
  };
}

/** 向后兼容的导出 */
export const fileSearchTool: Tool = createFileSearchTool(process.cwd());
