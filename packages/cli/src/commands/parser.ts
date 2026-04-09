/**
 * Slash 命令解析器
 *
 * 解析用户输入的 Slash 命令，支持参数和标志
 */

import type {
  SlashCommand,
  ParsedSlashCommand,
  SlashCommandRegistry,
  SlashCommandContext,
  SlashCommandResult,
} from "./types.js";

// ============================================================================
// 命令解析器
// ============================================================================

/**
 * 解析 Slash 命令字符串
 *
 * @param input 用户输入（以 / 开头）
 * @returns 解析结果
 */
export function parseSlashCommand(input: string): ParsedSlashCommand {
  const trimmed = input.trim();

  // 检查是否是 Slash 命令
  if (!trimmed.startsWith("/")) {
    return {
      name: "",
      args: [],
      flags: {},
      raw: input,
      valid: false,
      error: "Not a slash command",
    };
  }

  // 移除 / 前缀
  const content = trimmed.slice(1);

  // 空命令
  if (!content) {
    return {
      name: "",
      args: [],
      flags: {},
      raw: input,
      valid: false,
      error: "Empty command",
    };
  }

  // 分词
  const tokens = tokenize(content);

  // 第一个 token 是命令名
  const name = tokens[0]?.toLowerCase() ?? "";
  const restTokens = tokens.slice(1);

  // 解析参数和标志
  const { args, flags, error } = parseArgsAndFlags(restTokens);

  return {
    name,
    args,
    flags,
    raw: input,
    valid: !error,
    error,
  };
}

/**
 * 分词
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
        quoteChar = "";
      } else {
        current += char;
      }
    } else if (char === "\"" || char === "'") {
      inQuotes = true;
      quoteChar = char;
    } else if (char === " " || char === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * 解析参数和标志
 */
function parseArgsAndFlags(
  tokens: string[]
): { args: string[]; flags: Record<string, string | number | boolean>; error?: string } {
  const args: string[] = [];
  const flags: Record<string, string | number | boolean> = {};
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    // 长标志 --flag 或 --flag=value
    if (token?.startsWith("--")) {
      const flagPart = token.slice(2);
      const equalIndex = flagPart.indexOf("=");

      if (equalIndex !== -1) {
        // --flag=value
        const flagName = flagPart.slice(0, equalIndex);
        const flagValue = parseValue(flagPart.slice(equalIndex + 1));
        flags[flagName] = flagValue;
      } else {
        // --flag 或 --flag value
        const flagName = flagPart;
        const nextToken = tokens[i + 1];

        // 检查下一个 token 是否是值（不是标志）
        if (nextToken && !nextToken.startsWith("-")) {
          flags[flagName] = parseValue(nextToken);
          i++;
        } else {
          flags[flagName] = true;
        }
      }
    }
    // 短标志 -f 或 -f value
    else if (token?.startsWith("-") && token.length === 2) {
      const flagName = token[1]!;
      const nextToken = tokens[i + 1];

      if (nextToken && !nextToken.startsWith("-")) {
        flags[flagName] = parseValue(nextToken);
        i++;
      } else {
        flags[flagName] = true;
      }
    }
    // 组合短标志 -abc
    else if (token?.startsWith("-") && token.length > 2 && !token.startsWith("--")) {
      const flags_part = token.slice(1);
      for (const f of flags_part) {
        flags[f] = true;
      }
    }
    // 参数
    else if (token) {
      args.push(token);
    }

    i++;
  }

  return { args, flags };
}

/**
 * 解析值
 */
function parseValue(value: string): string | number | boolean {
  // 布尔值
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;

  // 数字
  const num = Number(value);
  if (!isNaN(num)) return num;

  // 字符串
  return value;
}

// ============================================================================
// 命令注册表
// ============================================================================

/**
 * 创建 Slash 命令注册表
 */
export function createSlashCommandRegistry(): SlashCommandRegistry {
  const commands = new Map<string, SlashCommand>();
  const aliases = new Map<string, string>();

  return {
    register(command: SlashCommand): void {
      commands.set(command.name.toLowerCase(), command);

      // 注册别名
      if (command.aliases) {
        for (const alias of command.aliases) {
          aliases.set(alias.toLowerCase(), command.name.toLowerCase());
        }
      }
    },

    unregister(name: string): void {
      const cmd = commands.get(name.toLowerCase());
      if (cmd?.aliases) {
        for (const alias of cmd.aliases) {
          aliases.delete(alias.toLowerCase());
        }
      }
      commands.delete(name.toLowerCase());
    },

    get(name: string): SlashCommand | undefined {
      const lowerName = name.toLowerCase();
      const cmd = commands.get(lowerName);
      if (cmd) return cmd;

      // 查找别名
      const realName = aliases.get(lowerName);
      if (realName) return commands.get(realName);

      return undefined;
    },

    getAll(): SlashCommand[] {
      return Array.from(commands.values());
    },

    search(query: string): SlashCommand[] {
      const lowerQuery = query.toLowerCase();
      return this.getAll().filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(lowerQuery) ||
          cmd.description.toLowerCase().includes(lowerQuery) ||
          cmd.aliases?.some((a) => a.toLowerCase().includes(lowerQuery))
      );
    },
  };
}

// ============================================================================
// 命令执行器
// ============================================================================

/**
 * 执行 Slash 命令
 */
export async function executeSlashCommand(
  parsed: ParsedSlashCommand,
  registry: SlashCommandRegistry,
  context: Partial<SlashCommandContext>
): Promise<SlashCommandResult> {
  if (!parsed.valid) {
    return {
      success: false,
      error: parsed.error ?? "Invalid command",
    };
  }

  const command = registry.get(parsed.name);

  if (!command) {
    return {
      success: false,
      error: `Unknown command: /${parsed.name}`,
    };
  }

  // 构建上下文
  const ctx: SlashCommandContext = {
    args: {},
    flags: parsed.flags,
    rawInput: parsed.raw,
    sessionId: context.sessionId,
    output: context.output ?? console.log,
    error: context.error ?? console.error,
  };

  // 映射参数
  if (command.args) {
    for (let i = 0; i < command.args.length; i++) {
      const argDef = command.args[i];
      const value = parsed.args[i];

      if (value === undefined && argDef.required) {
        return {
          success: false,
          error: `Missing required argument: ${argDef.name}`,
        };
      }

      ctx.args[argDef.name] = value ?? argDef.default ?? "";
    }
  }

  try {
    return await command.execute(ctx);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  parseSlashCommand,
  createSlashCommandRegistry,
  executeSlashCommand,
};
