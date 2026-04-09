/**
 * code_search 工具 — 代码语义搜索（正则 + 符号匹配）
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, extname } from "path";
import type { Tool, ToolResult } from "../agent/types.js";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".cache",
  "coverage",
  ".turbo",
]);
const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".vue",
  ".svelte",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".css",
  ".scss",
  ".html",
  ".md",
  ".yaml",
  ".yml",
  ".toml",
]);
const MAX_RESULTS = 30;
const MAX_FILE_SIZE = 100_000;

export function createCodeSearchTool(rootDir: string): Tool {
  return {
    name: "code_search",
    description:
      "Search for code patterns, symbols (functions, classes, interfaces, exports, imports), or regex across the codebase. Supports file pattern filtering.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Symbol name, text, or regex pattern to search for",
        },
        filePattern: {
          type: "string",
          description:
            "File extension or glob filter (e.g. '*.ts', '*.test.ts')",
        },
        isRegex: {
          type: "boolean",
          description: "Treat query as a regex pattern (default: false)",
        },
      },
      required: ["query"],
    },
    requiresApproval: false,

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const query = String(args.query);
      const isRegex = Boolean(args.isRegex);
      const results: string[] = [];

      // 编译文件过滤模式
      let fileFilter: RegExp | null = null;
      if (args.filePattern) {
        const pattern = String(args.filePattern)
          .replace(/\./g, "\\.")
          .replace(/\*/g, ".*");
        fileFilter = new RegExp(pattern, "i");
      }

      // 编译搜索模式
      let searchPattern: RegExp;
      try {
        searchPattern = isRegex
          ? new RegExp(query, "g")
          : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      } catch {
        return {
          success: false,
          output: "",
          error: `Invalid regex pattern: ${query}`,
        };
      }

      function searchDir(dir: string): void {
        if (results.length >= MAX_RESULTS) return;
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (results.length >= MAX_RESULTS) break;
            if (IGNORE_DIRS.has(entry.name)) continue;
            if (entry.name.startsWith(".") && entry.isDirectory()) continue;

            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
              searchDir(fullPath);
            } else {
              const ext = extname(entry.name);
              if (!CODE_EXTENSIONS.has(ext)) continue;

              // 应用文件过滤
              if (fileFilter && !fileFilter.test(entry.name)) continue;

              try {
                const stat = statSync(fullPath);
                if (stat.size > MAX_FILE_SIZE) continue;

                const content = readFileSync(fullPath, "utf-8");
                const lines = content.split("\n");
                const matches: string[] = [];

                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i]!;
                  searchPattern.lastIndex = 0;
                  if (searchPattern.test(line)) {
                    matches.push(
                      `  L${i + 1}: ${line.trim().slice(0, 120)}`,
                    );
                  }
                }

                if (matches.length > 0) {
                  results.push(
                    `${relative(rootDir, fullPath)} (${matches.length} match${matches.length > 1 ? "es" : ""})\n${matches.slice(0, 5).join("\n")}`,
                  );
                }
              } catch {
                /* skip unreadable */
              }
            }
          }
        } catch {
          /* permission error */
        }
      }

      searchDir(rootDir);

      const output =
        results.length > 0
          ? `Found matches in ${results.length} file(s):\n\n${results.join("\n\n")}`
          : `No matches for "${query}"`;

      return {
        success: true,
        output,
        metadata: { fileCount: results.length, query },
      };
    },
  };
}

/** 向后兼容的导出 */
export const codeSearchTool: Tool = createCodeSearchTool(process.cwd());
