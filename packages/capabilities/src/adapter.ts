/**
 * Capabilities 工具适配器
 *
 * 将 Capabilities 工具转换为可被 ToolBridge 使用的格式
 */

import type { z } from "zod";
import type { ToolDefinition as CapabilitiesToolDefinition } from "./types/index.js";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Provider 兼容的工具定义
 */
export interface ProviderCompatibleTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: unknown) => Promise<unknown>;
}

/**
 * 工具适配器接口
 */
export interface ToolAdapter {
  /**
   * 将 Capabilities 工具转换为 Provider 兼容格式
   */
  toProviderFormat(tool: CapabilitiesToolDefinition): ProviderCompatibleTool;

  /**
   * 获取工具的 JSON Schema
   */
  getJsonSchema(tool: CapabilitiesToolDefinition): Record<string, unknown>;
}

// ============================================================================
// Zod Schema 转换
// ============================================================================

/**
 * 将 Zod Schema 转换为 JSON Schema
 */
export function zodSchemaToJson(zodSchema: z.ZodType<unknown>): Record<string, unknown> {
  const def = zodSchema._def as { typeName: string; [key: string]: unknown };

  switch (def.typeName) {
    case "ZodObject": {
      const shape = (def.shape as () => Record<string, z.ZodType<unknown>>)();
      const properties: Record<string, Record<string, unknown>> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodSchemaToJson(value);
        // 检查是否可选
        if ((value._def as { typeName: string }).typeName !== "ZodOptional") {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
      };
    }

    case "ZodString":
      return {
        type: "string",
        description: (def.description as string) || undefined,
      };

    case "ZodNumber":
      return {
        type: "number",
        description: (def.description as string) || undefined,
      };

    case "ZodBoolean":
      return {
        type: "boolean",
        description: (def.description as string) || undefined,
      };

    case "ZodArray":
      return {
        type: "array",
        items: zodSchemaToJson(def.type as z.ZodType<unknown>),
      };

    case "ZodOptional":
      return zodSchemaToJson(def.innerType as z.ZodType<unknown>);

    case "ZodDefault": {
      const schema = zodSchemaToJson(def.innerType as z.ZodType<unknown>);
      return {
        ...schema,
        default: (def.defaultValue as () => unknown)(),
      };
    }

    case "ZodEnum":
      return {
        type: "string",
        enum: def.values as string[],
      };

    case "ZodNativeEnum":
      return {
        type: "string",
        enum: Object.values(def.values as Record<string, string>),
      };

    case "ZodLiteral":
      return {
        type: typeof def.value as "string" | "number" | "boolean",
        enum: [def.value],
      };

    case "ZodUnion":
      return {
        oneOf: (def.options as z.ZodType<unknown>[]).map(zodSchemaToJson),
      };

    case "ZodRecord":
      return {
        type: "object",
        additionalProperties: zodSchemaToJson(def.valueType as z.ZodType<unknown>),
      };

    default:
      return { type: "object" };
  }
}

// ============================================================================
// 工具适配器实现
// ============================================================================

/**
 * 默认工具适配器
 */
export const defaultToolAdapter: ToolAdapter = {
  toProviderFormat(tool: CapabilitiesToolDefinition): ProviderCompatibleTool {
    return {
      name: tool.name,
      description: tool.description,
      parameters: this.getJsonSchema(tool),
      execute: tool.execute,
    };
  },

  getJsonSchema(tool: CapabilitiesToolDefinition): Record<string, unknown> {
    // 检查是否是 Zod Schema
    if (tool.inputSchema && typeof tool.inputSchema._def === "object") {
      return zodSchemaToJson(tool.inputSchema);
    }
    // 假设已经是 JSON Schema 格式
    return tool.inputSchema as unknown as Record<string, unknown>;
  },
};

// ============================================================================
// 工具注册表适配器
// ============================================================================

import type { ToolRegistry } from "./tools/index.js";

/**
 * 创建兼容 ToolBridge 的工具注册表包装器
 */
export function createToolRegistryAdapter(registry: ToolRegistry) {
  return {
    /**
     * 获取所有工具列表
     */
    list(): ProviderCompatibleTool[] {
      return registry.list().map((tool) => defaultToolAdapter.toProviderFormat(tool));
    },

    /**
     * 执行工具
     */
    async execute(name: string, input: unknown): Promise<unknown> {
      return registry.execute(name, input);
    },

    /**
     * 检查工具是否存在
     */
    has(name: string): boolean {
      return registry.has(name);
    },

    /**
     * 获取单个工具
     */
    get(name: string): ProviderCompatibleTool | undefined {
      const tool = registry.get(name);
      return tool ? defaultToolAdapter.toProviderFormat(tool) : undefined;
    },
  };
}
