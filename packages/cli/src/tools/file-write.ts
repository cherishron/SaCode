/**
 * file_write 工具 — 写入/创建文件（支持完整写入和 search-replace 模式）
 */
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { resolve, dirname, relative } from "path";
import type { Tool, ToolResult } from "../agent/types.js";

interface SearchReplaceEntry {
  search: string;
  replace: string;
}

export function createFileWriteTool(rootDir: string): Tool {
  return {
    name: "file_write",
    description:
      "Write content to a file. Supports full write (create/overwrite) and search-replace mode. Creates parent directories automatically.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path (relative to project root or absolute)",
        },
        content: {
          type: "string",
          description: "Full file content (for create/overwrite mode)",
        },
        searchReplace: {
          type: "array",
          description: "Array of search/replace operations",
          items: {
            type: "object",
            properties: {
              search: { type: "string", description: "Text to find" },
              replace: { type: "string", description: "Replacement text" },
            },
            required: ["search", "replace"],
          },
        },
      },
      required: ["path"],
    },
    requiresApproval: true,

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const rawPath = String(args.path);
      const filePath = resolve(rootDir, rawPath);
      const relPath = relative(rootDir, filePath);

      try {
        // Search-replace 模式
        if (args.searchReplace) {
          if (!existsSync(filePath)) {
            return {
              success: false,
              output: "",
              error: `File not found for search/replace: ${relPath}`,
            };
          }

          let content = readFileSync(filePath, "utf-8");
          const entries = args.searchReplace as SearchReplaceEntry[];
          let replacedCount = 0;

          for (const entry of entries) {
            if (!content.includes(entry.search)) {
              return {
                success: false,
                output: "",
                error: `Search text not found in file: "${entry.search.slice(0, 60)}..."`,
              };
            }
            content = content.replace(entry.search, entry.replace);
            replacedCount++;
          }

          writeFileSync(filePath, content, "utf-8");
          return {
            success: true,
            output: `Applied ${replacedCount} replacement(s) in ${relPath}`,
            metadata: { replacements: replacedCount, path: filePath },
          };
        }

        // 完整写入模式
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        const fileContent = String(args.content || "");
        const isNew = !existsSync(filePath);
        writeFileSync(filePath, fileContent, "utf-8");

        const lines = fileContent.split("\n").length;
        const sizeKB = (Buffer.byteLength(fileContent, "utf-8") / 1024).toFixed(
          1,
        );

        return {
          success: true,
          output: `${isNew ? "Created" : "Updated"} ${relPath} (${lines} lines, ${sizeKB}KB)`,
          metadata: { path: filePath, lines, isNew },
        };
      } catch (err) {
        return {
          success: false,
          output: "",
          error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

/** 向后兼容的导出 */
export const fileWriteTool: Tool = createFileWriteTool(process.cwd());
