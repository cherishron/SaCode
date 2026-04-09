/**
 * diff_apply 工具 — 应用代码差异（unified diff 格式）
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, relative } from "path";
import type { Tool, ToolResult } from "../agent/types.js";

export function createDiffApplyTool(rootDir: string): Tool {
  return {
    name: "diff_apply",
    description:
      "Apply a unified diff patch to a file. Parses standard unified diff format (@@ -start,count +start,count @@) and applies additions/removals.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path to patch (relative to project root)",
        },
        diff: {
          type: "string",
          description: "Unified diff content",
        },
      },
      required: ["path", "diff"],
    },
    requiresApproval: true,

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const rawPath = String(args.path);
      const filePath = resolve(rootDir, rawPath);
      const relPath = relative(rootDir, filePath);
      const diff = String(args.diff);

      if (!existsSync(filePath)) {
        return {
          success: false,
          output: "",
          error: `File not found: ${relPath}`,
        };
      }

      try {
        const original = readFileSync(filePath, "utf-8");
        const lines = original.split("\n");
        const diffLines = diff.split("\n");
        const result: string[] = [...lines];

        let offset = 0;
        let addedLines = 0;
        let removedLines = 0;

        for (const line of diffLines) {
          // 跳过 diff 头部
          if (
            line.startsWith("---") ||
            line.startsWith("+++") ||
            line.startsWith("diff ")
          ) {
            continue;
          }

          if (line.startsWith("@@")) {
            // 解析 hunk 头: @@ -start,count +start,count @@
            const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
            if (match) {
              offset = Number(match[1]) - 1;
            }
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            // 删除行
            const content = line.slice(1);
            const idx = result.indexOf(content, Math.max(0, offset - 2));
            if (idx !== -1) {
              result.splice(idx, 1);
              removedLines++;
            } else {
              return {
                success: false,
                output: "",
                error: `Diff conflict: could not find line to remove near offset ${offset + 1}: "${content.slice(0, 80)}"`,
              };
            }
          } else if (line.startsWith("+") && !line.startsWith("+++")) {
            // 添加行
            const content = line.slice(1);
            result.splice(offset, 0, content);
            offset++;
            addedLines++;
          } else if (!line.startsWith("\\")) {
            // 上下文行
            offset++;
          }
        }

        writeFileSync(filePath, result.join("\n"), "utf-8");
        return {
          success: true,
          output: `Diff applied to ${relPath}: +${addedLines} -${removedLines} lines`,
          metadata: {
            path: filePath,
            addedLines,
            removedLines,
          },
        };
      } catch (err) {
        return {
          success: false,
          output: "",
          error: `Failed to apply diff: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

/** 向后兼容的导出 */
export const diffApplyTool: Tool = createDiffApplyTool(process.cwd());
