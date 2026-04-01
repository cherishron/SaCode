import { promises as fs } from "node:fs";
import { glob } from "glob";
import type {
  ToolDefinition,
  ReadFileInput,
  WriteFileInput,
  ListDirectoryInput,
  SearchFilesInput,
  FilesCapabilityConfig,
} from "../types";

export function createFileTools(config: FilesCapabilityConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // read_file
  tools.push({
    name: "read_file",
    description: "读取文件内容",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "path" in input) {
          return input as ReadFileInput;
        }
        throw new Error("Invalid input");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      if (!config.enabled) {
        throw new Error("Files capability is disabled");
      }

      const { path, limit, offset = 0 } = input as ReadFileInput;

      // 检查路径是否在允许目录内
      const isAllowed = config.allowedDirs.some((dir) => path.startsWith(dir));
      if (!isAllowed && config.allowedDirs.length > 0) {
        throw new Error(`Path not in allowed directories: ${path}`);
      }

      const content = await fs.readFile(path, "utf-8");

      if (limit !== undefined) {
        const lines = content.split("\n");
        const selectedLines = lines.slice(offset, offset + limit);
        return selectedLines.join("\n");
      }

      return content;
    },
  });

  // write_file
  if (!config.readOnly) {
    tools.push({
      name: "write_file",
      description: "写入文件内容",
      inputSchema: {
        parse: (input: unknown) => {
          if (typeof input === "object" && input !== null && "path" in input && "content" in input) {
            return input as WriteFileInput;
          }
          throw new Error("Invalid input");
        },
      } as unknown as ToolDefinition["inputSchema"],
      execute: async (input: unknown) => {
        if (!config.enabled) {
          throw new Error("Files capability is disabled");
        }

        const { path, content } = input as WriteFileInput;

        // 检查路径是否在允许目录内
        const isAllowed = config.allowedDirs.some((dir) => path.startsWith(dir));
        if (!isAllowed && config.allowedDirs.length > 0) {
          throw new Error(`Path not in allowed directories: ${path}`);
        }

        await fs.writeFile(path, content, "utf-8");
        return { success: true, path };
      },
    });
  }

  // list_directory
  tools.push({
    name: "list_directory",
    description: "列出目录内容",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "path" in input) {
          return input as ListDirectoryInput;
        }
        throw new Error("Invalid input");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      if (!config.enabled) {
        throw new Error("Files capability is disabled");
      }

      const { path, recursive = false } = input as ListDirectoryInput;

      const entries = await fs.readdir(path, { withFileTypes: true, recursive });

      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }));
    },
  });

  // search_files
  tools.push({
    name: "search_files",
    description: "搜索文件",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "pattern" in input) {
          return input as SearchFilesInput;
        }
        throw new Error("Invalid input");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      if (!config.enabled) {
        throw new Error("Files capability is disabled");
      }

      const { pattern, path = "." } = input as SearchFilesInput;

      const files = await glob(pattern, { cwd: path });
      return files;
    },
  });

  return tools;
}
