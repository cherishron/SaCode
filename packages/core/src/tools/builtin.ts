/**
 * 内置工具定义
 *
 * 提供基础的工具定义，用于 Provider Function Calling
 */

import type { UnifiedToolDefinition } from "./types";

// ============================================================================
// 内置工具定义
// ============================================================================

/**
 * 内置工具列表
 */
export const BUILTIN_TOOLS: UnifiedToolDefinition[] = [
  // ========================================
  // 对话控制工具
  // ========================================
  {
    name: "think",
    description: "Use this tool to think through complex problems before responding. This helps organize thoughts and plan actions.",
    parameters: {
      type: "object",
      properties: {
        thought: {
          type: "string",
          description: "The thought to process",
        },
      },
      required: ["thought"],
    },
    source: "builtin",
    handler: async (args) => {
      // 思考工具只返回确认，不执行任何操作
      return `[Thinking] ${args.thought as string}`;
    },
  },

  {
    name: "plan",
    description: "Create a structured plan for multi-step tasks. Use this to break down complex tasks into manageable steps.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: { type: "string" },
          description: "List of steps to execute",
        },
        goal: {
          type: "string",
          description: "The overall goal of the plan",
        },
      },
      required: ["steps", "goal"],
    },
    source: "builtin",
    handler: async (args) => {
      const steps = args.steps as string[];
      const goal = args.goal as string;
      let output = `# Plan: ${goal}\n\n`;
      steps.forEach((step, index) => {
        output += `${index + 1}. ${step}\n`;
      });
      return output;
    },
  },

  // ========================================
  // 信息获取工具
  // ========================================
  {
    name: "get_current_time",
    description: "Get the current date and time",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "Timezone (e.g., 'Asia/Shanghai', 'UTC')",
        },
      },
    },
    source: "builtin",
    handler: async (args) => {
      const timezone = args.timezone as string | undefined;
      const now = new Date();
      try {
        const options: Intl.DateTimeFormatOptions = {
          timeZone: timezone || "UTC",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        };
        return now.toLocaleString("zh-CN", options);
      } catch {
        return now.toISOString();
      }
    },
  },

  {
    name: "calculate",
    description: "Perform mathematical calculations safely",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Mathematical expression to evaluate (e.g., '2 + 2', 'Math.sqrt(16)')",
        },
      },
      required: ["expression"],
    },
    source: "builtin",
    dangerous: false,
    handler: async (args) => {
      const expression = args.expression as string;
      // 安全计算器 - 只允许基本数学运算
      const safeExpression = expression
        .replace(/[^0-9+\-*/.() Math.sqrtsincostanabsexplogfloorceilroundpowminmax]/g, "");
      try {
        // 使用 Function 构造器进行受限计算
        const fn = new Function(`return ${safeExpression}`);
        const result = fn();
        return `Result: ${result}`;
      } catch (error) {
        return `Calculation error: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  },

  // ========================================
  // 输出格式化工具
  // ========================================
  {
    name: "format_json",
    description: "Format a JSON string with proper indentation",
    parameters: {
      type: "object",
      properties: {
        json: {
          type: "string",
          description: "JSON string to format",
        },
        indent: {
          type: "number",
          description: "Indentation spaces (default: 2)",
        },
      },
      required: ["json"],
    },
    source: "builtin",
    handler: async (args) => {
      const json = args.json as string;
      const indent = (args.indent as number) ?? 2;
      try {
        const parsed = JSON.parse(json);
        return JSON.stringify(parsed, null, indent);
      } catch (error) {
        return `JSON parse error: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  },

  {
    name: "format_markdown",
    description: "Format text as markdown",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to format",
        },
        style: {
          type: "string",
          enum: ["heading", "bold", "italic", "code", "list", "quote"],
          description: "Markdown style to apply",
        },
        level: {
          type: "number",
          description: "Heading level (1-6, for heading style only)",
        },
      },
      required: ["text", "style"],
    },
    source: "builtin",
    handler: async (args) => {
      const text = args.text as string;
      const style = args.style as string;
      const level = args.level as number | undefined;

      switch (style) {
        case "heading":
          const headingLevel = Math.max(1, Math.min(6, level ?? 1));
          return `${"#".repeat(headingLevel)} ${text}`;
        case "bold":
          return `**${text}**`;
        case "italic":
          return `*${text}*`;
        case "code":
          return `\`${text}\``;
        case "list":
          return `- ${text}`;
        case "quote":
          return `> ${text}`;
        default:
          return text;
      }
    },
  },

  // ========================================
  // 对话管理工具
  // ========================================
  {
    name: "ask_clarification",
    description: "Ask the user for clarification when the request is ambiguous",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The clarification question to ask",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of choices for the user",
        },
      },
      required: ["question"],
    },
    source: "builtin",
    handler: async (args) => {
      const question = args.question as string;
      const options = args.options as string[] | undefined;
      let output = `[?] **Clarification needed**: ${question}`;
      if (options && options.length > 0) {
        output += "\n\nOptions:\n";
        options.forEach((opt, index) => {
          output += `${index + 1}. ${opt}\n`;
        });
      }
      return output;
    },
  },

  {
    name: "summarize",
    description: "Summarize a long text or conversation",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to summarize",
        },
        max_length: {
          type: "number",
          description: "Maximum summary length in words",
        },
      },
      required: ["text"],
    },
    source: "builtin",
    handler: async (args) => {
      const text = args.text as string;
      const maxLength = (args.max_length as number) ?? 100;
      // 简单截断作为基础实现
      const words = text.split(/\s+/);
      if (words.length <= maxLength) {
        return text;
      }
      return words.slice(0, maxLength).join(" ") + "...";
    },
  },
];

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取内置工具名称列表
 */
export function getBuiltinToolNames(): string[] {
  return BUILTIN_TOOLS.map((tool) => tool.name);
}

/**
 * 获取内置工具定义
 */
export function getBuiltinTool(name: string): UnifiedToolDefinition | undefined {
  return BUILTIN_TOOLS.find((tool) => tool.name === name);
}

/**
 * 检查是否为内置工具
 */
export function isBuiltinTool(name: string): boolean {
  return BUILTIN_TOOLS.some((tool) => tool.name === name);
}
