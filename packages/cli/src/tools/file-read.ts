/**
 * file_read 工具 — 读取文件内容（支持行范围）
 */
import { existsSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import type { Tool, ToolResult } from "../agent/types.js";

const MAX_FILE_SIZE = 50_000; // 50KB
const SUMMARY_THRESHOLD = MAX_FILE_SIZE;

export function createFileReadTool(rootDir: string): Tool {
  return {
    name: "file_read",
    description:
      "Read the contents of a file. Supports optional line range. Files over 50KB return a summary instead of full content.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path (relative to project root or absolute)",
        },
        startLine: {
          type: "number",
          description: "Start line (1-based, inclusive, optional)",
        },
        endLine: {
          type: "number",
          description: "End line (1-based, inclusive, optional)",
        },
      },
      required: ["path"],
    },
    requiresApproval: false,

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const rawPath = String(args.path);
      const filePath = resolve(rootDir, rawPath);

      if (!existsSync(filePath)) {
        return {
          success: false,
          output: "",
          error: `File not found: ${rawPath}`,
        };
      }

      try {
        const stat = statSync(filePath);

        // 超过阈值返回摘要
        if (stat.size > SUMMARY_THRESHOLD) {
          const sizeKB = (stat.size / 1024).toFixed(1);
          const preview = readFileSync(filePath, "utf-8").slice(0, 500);
          const lineCount = readFileSync(filePath, "utf-8").split("\n").length;
          return {
            success: true,
            output: `[File summary: ${rawPath} — ${sizeKB}KB, ${lineCount} lines]\n\nFirst 500 chars:\n${preview}\n\n... Use startLine/endLine to read specific sections.`,
            metadata: { size: stat.size, lines: lineCount, truncated: true },
          };
        }

        let content = readFileSync(filePath, "utf-8");

        // 行范围截取
        if (args.startLine || args.endLine) {
          const lines = content.split("\n");
          const start = Math.max(1, Number(args.startLine) || 1) - 1;
          const end = Math.min(
            lines.length,
            Number(args.endLine) || lines.length,
          );
          content = lines
            .slice(start, end)
            .map((line, i) => `${start + i + 1}: ${line}`)
            .join("\n");
        }

        return {
          success: true,
          output: content,
          metadata: { size: stat.size, path: filePath },
        };
      } catch (err) {
        return {
          success: false,
          output: "",
          error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

/** 向后兼容的导出（使用 process.cwd() 作为 rootDir） */
export const fileReadTool: Tool = createFileReadTool(process.cwd());
