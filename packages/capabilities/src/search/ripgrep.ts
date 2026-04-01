/**
 * ripgrep 封装
 *
 * 提供基于 ripgrep 的高性能代码搜索能力
 */

import { promises as fs } from "node:fs";
import pathModule from "node:path";
import { execa } from "execa";
import type { ToolDefinition } from "../types";
import type { GrepToolInput, GrepToolResult, SearchCapabilityConfig } from "../types";

/**
 * 检测 ripgrep 是否可用
 */
async function checkRipgrepAvailable(): Promise<boolean> {
  try {
    await execa("rg", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 使用 ripgrep 进行搜索
 */
async function searchWithRipgrep(input: GrepToolInput): Promise<GrepToolResult> {
  const {
    pattern,
    path = ".",
    caseSensitive = false,
    contextLines = 2,
    filePattern,
    excludePatterns = [],
    maxResults = 100,
    ignoreHidden = true,
  } = input;

  // 构建命令参数
  const args: string[] = [];

  // 添加模式
  args.push(pattern);

  // 添加搜索路径
  args.push(path);

  // 添加选项
  if (!caseSensitive) {
    args.push("--ignore-case");
  }

  args.push("--context", contextLines.toString());
  args.push("--no-heading");
  args.push("--line-number");
  args.push("--color", "never");

  if (ignoreHidden) {
    args.push("--hidden");
    args.push("--glob", "!**/.git/**");
    args.push("--glob", "!**/node_modules/**");
  }

  if (filePattern) {
    args.push("--glob", filePattern);
  }

  for (const exclude of excludePatterns) {
    args.push("--glob", `!${exclude}`);
  }

  args.push("--max-count", maxResults.toString());

  // 执行命令
  const { stdout } = await execa("rg", args, {
    timeout: 30000,
    reject: false,
  });

  // 解析输出
  const matches: GrepToolResult["matches"] = [];
  const lines = stdout.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    // 解析 ripgrep 输出格式: file:line:line_content
    const match = line.match(/^([^:]+):(\d+):-(.*)$/);
    if (match) {
      const [, file, lineNum, lineContent] = match;
      matches.push({
        file,
        lineNumber: parseInt(lineNum, 10),
        line: lineContent ?? "",
        contextBefore: [],
        contextAfter: [],
      });
    }
  }

  return {
    matches,
    totalMatches: matches.length,
    filesSearched: matches.length,
  };
}

/**
 * 内置搜索（当 ripgrep 不可用时使用）
 */
async function searchBuiltin(input: GrepToolInput): Promise<GrepToolResult> {
  const {
    pattern,
    path = ".",
    caseSensitive = false,
    maxResults = 100,
  } = input;

  const matches: GrepToolResult["matches"] = [];
  let totalMatches = 0;

  // 构建正则表达式
  const flags = caseSensitive ? "g" : "gi";
  const regex = new RegExp(pattern, flags);

  // 递归搜索文件
  async function searchDirectory(dir: string): Promise<void> {
    if (totalMatches >= maxResults) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (totalMatches >= maxResults) break;

        const fullPath = pathModule.join(dir, entry.name);

        // 跳过隐藏文件和目录
        if (entry.name.startsWith(".")) {
          continue;
        }

        // 跳过 node_modules 和 .git
        if (entry.name === "node_modules" || entry.name === ".git") {
          continue;
        }

        if (entry.isDirectory()) {
          await searchDirectory(fullPath);
        } else if (entry.isFile()) {
          // 只搜索文本文件
          if (/\.(js|ts|jsx|tsx|py|java|go|rs|c|cpp|h|cs|php|rb|sh|bash|zsh|fish|ps1|cmd|bat|html|css|scss|less|json|xml|yaml|yml|toml|ini|conf|cfg|txt|md|markdown|rst|tex|sql|pl|pm|lua|r|m|swift|kt|kts|groovy|scala|clj|cljs|cljc|ex|exs|erl|hrl|dart|fs|fsi|fsx|v|sv|vhdl|verilog|asm|s|S|nasm|masm|tasm|fasm|ada|adb|ads|adb|ads|pas|pp|inc|d|di|nim|nims|cr|rs|go|rs|java|kt|kts|scala|sc|groovy|gvy|gy|gsh|clj|cljs|cljc|edn|lua|moon|r|m|R|jl|hs|lhs|ml|mli|fs|fsi|fsx|v|sv|vhdl|verilog|tcl|expect|itk|ns|nsi|nsh|ps1|psm1|psd1|bat|cmd|sh|bash|zsh|fish|csh|tcsh|ksh|awk|sed|perl|pl|pm|t|pod|php|phtml|phps|asp|aspx|jsp|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jspx|jsx|tsx|ts|js|jsx|tsx|ts|js|jsx|tsx|ts|js|jsx|tsx|ts|js|jsx|tsx|ts)$/.test(entry.name)) {
            try {
              const content = await fs.readFile(fullPath, "utf-8");
              const lines = content.split("\n");

              for (let i = 0; i < lines.length; i++) {
                if (totalMatches >= maxResults) break;

                const line = lines[i];
                if (regex.test(line)) {
                  matches.push({
                    file: fullPath,
                    lineNumber: i + 1,
                    line: line,
                    contextBefore: [],
                    contextAfter: [],
                  });
                  totalMatches++;
                }
              }
            } catch {
              // 忽略无法读取的文件
            }
          }
        }
      }
    } catch {
      // 忽略无法访问的目录
    }
  }

  await searchDirectory(path);

  return {
    matches,
    totalMatches,
    filesSearched: matches.length,
  };
}

/**
 * 创建 grep_tool 工具
 */
export function createGrepTool(config: SearchCapabilityConfig): ToolDefinition {
  return {
    name: "grep_tool",
    description: "在代码中搜索文本模式，支持正则表达式和上下文显示。如果 ripgrep 可用，将使用它以获得更好的性能；否则使用内置搜索。",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "pattern" in input) {
          const parsed = input as GrepToolInput;

          if (typeof parsed.pattern !== "string" || parsed.pattern.length === 0) {
            throw new Error("Pattern must be a non-empty string");
          }

          return parsed;
        }
        throw new Error("Invalid input: expected GrepToolInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as GrepToolInput;

      try {
        // 检查是否应该使用 ripgrep
        const useRipgrep = config.useRipgrep !== false && (await checkRipgrepAvailable());

        let result: GrepToolResult;

        if (useRipgrep) {
          result = await searchWithRipgrep(typedInput);
        } else {
          result = await searchBuiltin(typedInput);
        }

        // 格式化输出
        let output = `# 搜索结果: ${typedInput.pattern}\n\n`;
        output += `**搜索路径**: ${typedInput.path || "."}\n`;
        output += `**匹配数量**: ${result.totalMatches}\n`;
        output += `**搜索文件**: ${result.filesSearched}\n`;
        output += `**搜索引擎**: ${useRipgrep ? "ripgrep (rg)" : "内置搜索"}\n\n`;

        if (result.matches.length === 0) {
          output += "未找到匹配结果。\n";
        } else {
          output += `## 匹配结果 (${result.matches.length})\n\n`;

          for (let i = 0; i < result.matches.length; i++) {
            const match = result.matches[i];
            output += `### ${i + 1}. ${match.file}:${match.lineNumber}\n\n`;
            output += `\`\`\`\n${match.line}\n\`\`\`\n\n`;
          }
        }

        return output;
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`Grep search failed: ${error.message}`);
        }
        throw error;
      }
    },
  };
}
