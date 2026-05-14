import { promises as fs } from "node:fs";
import path from "node:path";
import { glob } from "glob";
import type {
  ToolDefinition,
  ReadFileInput,
  WriteFileInput,
  ListDirectoryInput,
  SearchFilesInput,
  FilesCapabilityConfig,
} from "../types";
import { createEditFileTool } from "./edit";

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
      await ensureAllowedPath(path, config.allowedDirs);

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
        await ensureAllowedPath(path, config.allowedDirs, { allowMissingTarget: true });

        await fs.writeFile(path, content, "utf-8");
        return { success: true, path };
      },
    });
  }

  // edit_file
  if (!config.readOnly) {
    tools.push(createEditFileTool(config));
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
      await ensureAllowedPath(path, config.allowedDirs);

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
      await ensureAllowedPath(path, config.allowedDirs);

      const files = await glob(pattern, { cwd: path });
      return files;
    },
  });

  return tools;
}

async function ensureAllowedPath(
  targetPath: string,
  allowedDirs: string[],
  options: { allowMissingTarget?: boolean } = {}
): Promise<void> {
  if (allowedDirs.length === 0) return;

  const resolvedTarget = path.resolve(targetPath);
  const targetToCheck = options.allowMissingTarget
    ? path.dirname(resolvedTarget)
    : resolvedTarget;
  const realTarget = await fs.realpath(targetToCheck);

  for (const dir of allowedDirs) {
    const realAllowed = await fs.realpath(path.resolve(dir));
    const relative = path.relative(realAllowed, realTarget);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return;
    }
  }

  throw new Error(`Path not in allowed directories: ${targetPath}`);
}
