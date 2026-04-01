/**
 * 文件编辑工具
 *
 * 支持行范围替换、正则表达式替换和字符串替换
 */

import { promises as fs } from "node:fs/promises";
import type { ToolDefinition } from "../types";
import type { EditFileInput, DeleteFileInput, FilesCapabilityConfig } from "../types";

/**
 * 生成简单的 diff 输出
 */
function generateDiff(original: string, modified: string): string {
  const originalLines = original.split("\n");
  const modifiedLines = modified.split("\n");

  let diff = "";
  let lineNum = 1;

  for (let i = 0; i < Math.max(originalLines.length, modifiedLines.length); i++) {
    const origLine = originalLines[i];
    const modLine = modifiedLines[i];

    if (origLine === undefined) {
      diff += `+ ${lineNum}: ${modLine}\n`;
    } else if (modLine === undefined) {
      diff += `- ${lineNum}: ${origLine}\n`;
    } else if (origLine !== modLine) {
      diff += `~ ${lineNum}:\n`;
      diff += `  - ${origLine}\n`;
      diff += `  + ${modLine}\n`;
    }

    lineNum++;
  }

  return diff;
}

/**
 * 执行行范围替换
 */
function applyLineEdit(lines: string[], edit: EditFileInput["edits"][0]): string[] {
  const { startLine, endLine, newText } = edit;

  if (startLine === undefined || endLine === undefined) {
    throw new Error("Line edit requires startLine and endLine");
  }

  // 转换为 0-based 索引
  const startIndex = startLine - 1;
  const endIndex = endLine;

  // 替换指定行范围
  const newLines = newText.split("\n");
  return [
    ...lines.slice(0, startIndex),
    ...newLines,
    ...lines.slice(endIndex),
  ];
}

/**
 * 执行正则表达式替换
 */
function applyRegexEdit(content: string, edit: EditFileInput["edits"][0]): string {
  const { regex, flags, newText } = edit;

  if (regex === undefined) {
    throw new Error("Regex edit requires regex pattern");
  }

  try {
    const regexObj = new RegExp(regex, flags || "g");
    return content.replace(regexObj, newText);
  } catch (error) {
    throw new Error(`Invalid regex pattern: ${error}`);
  }
}

/**
 * 执行字符串替换
 */
function applyStringEdit(content: string, edit: EditFileInput["edits"][0]): string {
  const { oldText, newText } = edit;

  if (oldText === undefined) {
    throw new Error("String edit requires oldText");
  }

  return content.replace(oldText, newText);
}

/**
 * 创建 edit_file 工具
 */
export function createEditFileTool(config: FilesCapabilityConfig): ToolDefinition {
  return {
    name: "edit_file",
    description: "编辑文件内容，支持行范围替换、正则表达式替换和字符串替换",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "path" in input && "edits" in input) {
          const parsed = input as EditFileInput;

          if (!Array.isArray(parsed.edits) || parsed.edits.length === 0) {
            throw new Error("Edits must be a non-empty array");
          }

          for (const edit of parsed.edits) {
            if (!edit.type || !["line", "regex", "string"].includes(edit.type)) {
              throw new Error("Each edit must have a valid type (line, regex, or string)");
            }
            if (edit.newText === undefined) {
              throw new Error("Each edit must have newText");
            }
          }

          return parsed;
        }
        throw new Error("Invalid input: expected EditFileInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as EditFileInput;

      if (!config.enabled) {
        throw new Error("Files capability is disabled");
      }

      if (config.readOnly) {
        throw new Error("Files capability is in read-only mode");
      }

      const { path, edits, createBackup = true, dryRun = false } = typedInput;

      // 检查路径是否在允许目录内
      const isAllowed = config.allowedDirs.some((dir) => path.startsWith(dir));
      if (!isAllowed && config.allowedDirs.length > 0) {
        throw new Error(`Path not in allowed directories: ${path}`);
      }

      try {
        // 读取文件内容
        const originalContent = await fs.readFile(path, "utf-8");

        // 应用所有编辑操作
        let modifiedContent = originalContent;

        for (const edit of edits) {
          switch (edit.type) {
            case "line":
              const lines = modifiedContent.split("\n");
              modifiedContent = applyLineEdit(lines, edit).join("\n");
              break;

            case "regex":
              modifiedContent = applyRegexEdit(modifiedContent, edit);
              break;

            case "string":
              modifiedContent = applyStringEdit(modifiedContent, edit);
              break;
          }
        }

        // 生成 diff
        const diff = generateDiff(originalContent, modifiedContent);

        // 如果是 dry-run，只返回预览
        if (dryRun) {
          let output = `# 编辑预览: ${path}\n\n`;
          output += `## Diff\n\n`;
          output += diff;
          output += `\n**注意**: 这是预览模式，文件未被修改。\n`;
          output += `移除 dryRun 参数以实际应用更改。\n`;
          return output;
        }

        // 创建备份
        if (createBackup) {
          const backupPath = `${path}.bak`;
          await fs.copyFile(path, backupPath);
        }

        // 写入修改后的内容
        await fs.writeFile(path, modifiedContent, "utf-8");

        // 返回结果
        let output = `# 文件已编辑: ${path}\n\n`;
        output += `## 应用 ${edits.length} 个编辑操作\n\n`;
        output += `## Diff\n\n`;
        output += diff;

        if (createBackup) {
          output += `\n**备份**: 已创建备份文件 ${path}.bak\n`;
        }

        return output;
      } catch (error) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`File not found: ${path}`);
        }
        throw error;
      }
    },
  };
}

/**
 * 创建 delete_file 工具
 */
export function createDeleteFileTool(config: FilesCapabilityConfig): ToolDefinition {
  return {
    name: "delete_file",
    description: "删除文件或目录，支持递归删除和移动到回收站",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "path" in input) {
          return input as DeleteFileInput;
        }
        throw new Error("Invalid input: expected DeleteFileInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as DeleteFileInput;

      if (!config.enabled) {
        throw new Error("Files capability is disabled");
      }

      if (config.readOnly) {
        throw new Error("Files capability is in read-only mode");
      }

      const { path, recursive = false, force = false, moveToTrash = true } = typedInput;

      // 检查路径是否在允许目录内
      const isAllowed = config.allowedDirs.some((dir) => path.startsWith(dir));
      if (!isAllowed && config.allowedDirs.length > 0) {
        throw new Error(`Path not in allowed directories: ${path}`);
      }

      try {
        // 检查路径是否存在
        const stats = await fs.stat(path);

        if (stats.isDirectory()) {
          if (moveToTrash) {
            // TODO: 实现跨平台回收站功能
            // 目前暂时直接删除
            await fs.rm(path, { recursive, force });
          } else {
            await fs.rm(path, { recursive, force });
          }
          return `目录已删除: ${path}`;
        } else {
          if (moveToTrash) {
            // TODO: 实现跨平台回收站功能
            // 目前暂时直接删除
            await fs.unlink(path);
          } else {
            await fs.unlink(path);
          }
          return `文件已删除: ${path}`;
        }
      } catch (error) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`File or directory not found: ${path}`);
        }
        throw error;
      }
    },
  };
}
