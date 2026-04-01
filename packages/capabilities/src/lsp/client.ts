/**
 * LSP 客户端
 *
 * 简化的 LSP 客户端实现
 */

import { promises as fs } from "node:fs";
import type { ToolDefinition } from "../types";
import type { LspToolInput, LspToolResult, LspCapabilityConfig } from "../types";

/**
 * 执行 LSP 操作
 */
async function executeLspAction(
  _config: LspCapabilityConfig,
  input: LspToolInput
): Promise<LspToolResult> {
  const { action, uri, newName } = input;

  // 提取文件路径
  const filePath = uri.replace(/^file:\/\/\//, "");

  try {
    // 检查文件是否存在
    await fs.access(filePath);

    switch (action) {
      case "diagnostics":
        return {
          action,
          uri,
          result: {
            message: "LSP diagnostics: 文件已检查，未发现错误（模拟结果）",
            diagnostics: [],
          },
        };

      case "definition":
        return {
          action,
          uri,
          result: {
            message: "跳转到定义（模拟结果）",
            location: {
              uri,
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
            },
          },
        };

      case "references":
        return {
          action,
          uri,
          result: {
            message: "查找引用（模拟结果）",
            references: [],
          },
        };

      case "completion":
        return {
          action,
          uri,
          result: {
            message: "代码补全（模拟结果）",
            items: [],
          },
        };

      case "symbols":
        return {
          action,
          uri,
          result: {
            message: "符号搜索（模拟结果）",
            symbols: [],
          },
        };

      case "format":
        return {
          action,
          uri,
          result: {
            message: "代码格式化（模拟结果）",
            edits: [],
          },
        };

      case "rename":
        if (!newName) {
          throw new Error("Rename action requires newName parameter");
        }
        return {
          action,
          uri,
          result: {
            message: `重命名符号为 "${newName}"（模拟结果）`,
            edits: [],
          },
        };

      default:
        throw new Error(`Unknown LSP action: ${action}`);
    }
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        action,
        uri,
        error: `File not found: ${filePath}`,
      };
    }
    throw error;
  }
}

/**
 * 创建 lsp_tool 工具
 */
export function createLspTool(config: LspCapabilityConfig): ToolDefinition {
  return {
    name: "lsp_tool",
    description: "与语言服务器协议（LSP）集成，提供代码智能功能如定义跳转、查找引用、代码补全、诊断信息等",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "action" in input && "uri" in input) {
          const parsed = input as LspToolInput;

          const validActions = ["definition", "references", "completion", "diagnostics", "symbols", "format", "rename"];
          if (!validActions.includes(parsed.action)) {
            throw new Error(`Invalid action: ${parsed.action}`);
          }

          if (typeof parsed.uri !== "string" || !parsed.uri.startsWith("file://")) {
            throw new Error("URI must be a valid file URI (file://)");
          }

          return parsed;
        }
        throw new Error("Invalid input: expected LspToolInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as LspToolInput;

      try {
        const result = await executeLspAction(config, typedInput);

        // 格式化输出
        let output = `# LSP 操作结果\n\n`;
        output += `**操作**: ${result.action}\n`;
        output += `**文件**: ${result.uri}\n\n`;

        if (result.error) {
          output += `## 错误\n\n${result.error}\n`;
        } else if (result.result) {
          output += `## 结果\n\n`;
          output += JSON.stringify(result.result, null, 2);
        }

        return output;
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`LSP operation failed: ${error.message}`);
        }
        throw error;
      }
    },
  };
}