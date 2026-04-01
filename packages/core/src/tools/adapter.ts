/**
 * 工具定义适配器
 *
 * 负责在不同工具定义格式之间进行转换
 */

import type { z } from "zod";
import type { ToolDefinition as ProviderToolDefinition } from "../provider";
import type {
  UnifiedToolDefinition,
  CapabilitiesToolDefinition,
  MCPToolDefinition,
  ToolParameterSchema,
  ToolHandler,
  ToolDefinitionConverter,
} from "./types";

// ============================================================================
// Zod 内部类型定义
// ============================================================================

interface ZodObjectDef {
  typeName: "ZodObject";
  shape: () => Record<string, z.ZodType<unknown>>;
}

interface ZodStringDef {
  typeName: "ZodString";
  description?: string;
}

interface ZodNumberDef {
  typeName: "ZodNumber";
  description?: string;
}

interface ZodBooleanDef {
  typeName: "ZodBoolean";
  description?: string;
}

interface ZodArrayDef {
  typeName: "ZodArray";
  type: z.ZodType<unknown>;
}

interface ZodOptionalDef {
  typeName: "ZodOptional";
  innerType: z.ZodType<unknown>;
  description?: string;
}

interface ZodDefaultDef {
  typeName: "ZodDefault";
  innerType: z.ZodType<unknown>;
  defaultValue: () => unknown;
}

interface ZodEnumDef {
  typeName: "ZodEnum";
  values: string[];
}

interface ZodNativeEnumDef {
  typeName: "ZodNativeEnum";
  values: Record<string, string | number>;
}

interface ZodLiteralDef {
  typeName: "ZodLiteral";
  value: string | number | boolean | null | undefined;
}

interface ZodNullableDef {
  typeName: "ZodNullable";
  innerType: z.ZodType<unknown>;
}

interface ZodUnionDef {
  typeName: "ZodUnion";
  options: z.ZodType<unknown>[];
}

interface ZodRecordDef {
  typeName: "ZodRecord";
  valueType: z.ZodType<unknown>;
}

type ZodDef =
  | ZodObjectDef
  | ZodStringDef
  | ZodNumberDef
  | ZodBooleanDef
  | ZodArrayDef
  | ZodOptionalDef
  | ZodDefaultDef
  | ZodEnumDef
  | ZodNativeEnumDef
  | ZodLiteralDef
  | ZodNullableDef
  | ZodUnionDef
  | ZodRecordDef
  | { typeName: string; [key: string]: unknown };

// ============================================================================
// Zod Schema 转 JSON Schema
// ============================================================================

/**
 * 将 Zod Schema 转换为 JSON Schema
 */
export function zodToJsonSchema(zodSchema: z.ZodType<unknown>): ToolParameterSchema {
  const def = zodSchema._def as ZodDef;

  // 处理 ZodObject
  if (def.typeName === "ZodObject") {
    const objectDef = def as ZodObjectDef;
    const shape = objectDef.shape();
    const properties: Record<string, ToolParameterSchema> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape) as [string, z.ZodType<unknown>][]) {
      properties[key] = zodToJsonSchema(value);
      // 检查是否可选
      const valueDef = value._def as ZodDef;
      if (valueDef.typeName !== "ZodOptional") {
        required.push(key);
      }
    }

    const result: ToolParameterSchema = {
      type: "object",
      properties,
    };
    if (required.length > 0) {
      result.required = required;
    }
    return result;
  }

  // 处理 ZodString
  if (def.typeName === "ZodString") {
    const stringDef = def as ZodStringDef;
    const schema: ToolParameterSchema = { type: "string" };
    if (stringDef.description) {
      schema.description = stringDef.description;
    }
    return schema;
  }

  // 处理 ZodNumber
  if (def.typeName === "ZodNumber") {
    const numberDef = def as ZodNumberDef;
    const schema: ToolParameterSchema = { type: "number" };
    if (numberDef.description) {
      schema.description = numberDef.description;
    }
    return schema;
  }

  // 处理 ZodBoolean
  if (def.typeName === "ZodBoolean") {
    const boolDef = def as ZodBooleanDef;
    const schema: ToolParameterSchema = { type: "boolean" };
    if (boolDef.description) {
      schema.description = boolDef.description;
    }
    return schema;
  }

  // 处理 ZodArray
  if (def.typeName === "ZodArray") {
    const arrayDef = def as ZodArrayDef;
    return {
      type: "array",
      items: zodToJsonSchema(arrayDef.type),
    };
  }

  // 处理 ZodOptional
  if (def.typeName === "ZodOptional") {
    const optionalDef = def as ZodOptionalDef;
    const innerSchema = zodToJsonSchema(optionalDef.innerType);
    if (optionalDef.description) {
      innerSchema.description = optionalDef.description;
    }
    return innerSchema;
  }

  // 处理 ZodDefault
  if (def.typeName === "ZodDefault") {
    const defaultDef = def as ZodDefaultDef;
    const innerSchema = zodToJsonSchema(defaultDef.innerType);
    innerSchema.default = defaultDef.defaultValue();
    return innerSchema;
  }

  // 处理 ZodEnum
  if (def.typeName === "ZodEnum") {
    const enumDef = def as ZodEnumDef;
    return {
      type: "string",
      enum: enumDef.values,
    };
  }

  // 处理 ZodNativeEnum
  if (def.typeName === "ZodNativeEnum") {
    const nativeEnumDef = def as ZodNativeEnumDef;
    return {
      type: "string",
      enum: Object.values(nativeEnumDef.values).map(String),
    };
  }

  // 处理 ZodLiteral
  if (def.typeName === "ZodLiteral") {
    const literalDef = def as ZodLiteralDef;
    const value = literalDef.value;
    const valueType = typeof value;
    // 过滤 undefined 和 null，只保留有效值
    const enumValue = value !== undefined && value !== null ? String(value) : "";
    return {
      type: valueType === "string" ? "string" : valueType === "number" ? "number" : "boolean",
      enum: [enumValue],
    };
  }

  // 处理 ZodNullable
  if (def.typeName === "ZodNullable") {
    const nullableDef = def as ZodNullableDef;
    const innerSchema = zodToJsonSchema(nullableDef.innerType);
    return {
      type: innerSchema.type,
      oneOf: [innerSchema, { type: "null" }],
    };
  }

  // 处理 ZodUnion
  if (def.typeName === "ZodUnion") {
    const unionDef = def as ZodUnionDef;
    const options = unionDef.options.map(zodToJsonSchema);
    // 尝试推断公共类型
    const types = new Set(options.map((o) => o.type));
    const commonType = types.size === 1 ? [...types][0] : undefined;
    return {
      type: commonType ?? "object",
      oneOf: options,
    };
  }

  // 处理 ZodRecord
  if (def.typeName === "ZodRecord") {
    const recordDef = def as ZodRecordDef;
    return {
      type: "object",
      additionalProperties: zodToJsonSchema(recordDef.valueType),
    };
  }

  // 默认返回 object 类型
  return { type: "object" };
}

// ============================================================================
// Capabilities 工具转换器
// ============================================================================

/**
 * Capabilities 工具定义转换器
 */
export const CapabilitiesToolConverter: ToolDefinitionConverter<CapabilitiesToolDefinition> = {
  convert(source: CapabilitiesToolDefinition): UnifiedToolDefinition {
    // 尝试从 Zod Schema 转换
    let parameters: ToolParameterSchema;
    
    if (source.inputSchema && typeof source.inputSchema._def === "object") {
      // 是 Zod Schema
      parameters = zodToJsonSchema(source.inputSchema as unknown as z.ZodType<unknown>);
    } else if (source.inputSchema && typeof source.inputSchema === "object") {
      // 已经是 JSON Schema 格式
      parameters = source.inputSchema as ToolParameterSchema;
    } else {
      // 默认空参数
      parameters = { type: "object", properties: {} };
    }

    // 创建包装器处理函数
    const handler: ToolHandler = async (args: Record<string, unknown>) => {
      const result = await source.execute(args);
      return typeof result === "string" ? result : JSON.stringify(result, null, 2);
    };

    return {
      name: source.name,
      description: source.description,
      parameters,
      source: "capabilities",
      handler,
    };
  },

  toProviderFormat(unified: UnifiedToolDefinition): ProviderToolDefinition {
    return {
      type: "function",
      function: {
        name: unified.name,
        description: unified.description,
        parameters: unified.parameters as Record<string, unknown>,
      },
    };
  },
};

// ============================================================================
// MCP 工具转换器
// ============================================================================

/**
 * MCP 工具定义转换器
 */
export const MCPToolConverter: ToolDefinitionConverter<MCPToolDefinition> = {
  convert(source: MCPToolDefinition): UnifiedToolDefinition {
    const result: UnifiedToolDefinition = {
      name: source.name,
      description: source.description ?? `MCP Tool: ${source.name}`,
      parameters: source.inputSchema as ToolParameterSchema,
      source: "mcp",
      // MCP 工具的 handler 需要通过 MCP 客户端调用，不设置
    };
    return result;
  },

  toProviderFormat(unified: UnifiedToolDefinition): ProviderToolDefinition {
    return {
      type: "function",
      function: {
        name: unified.name,
        description: unified.description,
        parameters: unified.parameters as Record<string, unknown>,
      },
    };
  },
};

// ============================================================================
// 批量转换函数
// ============================================================================

/**
 * 批量转换 Capabilities 工具
 */
export function convertCapabilitiesTools(
  tools: CapabilitiesToolDefinition[]
): UnifiedToolDefinition[] {
  return tools.map((tool) => CapabilitiesToolConverter.convert(tool));
}

/**
 * 批量转换 MCP 工具
 */
export function convertMCPTools(
  tools: MCPToolDefinition[]
): UnifiedToolDefinition[] {
  return tools.map((tool) => MCPToolConverter.convert(tool));
}

/**
 * 将统一工具定义转换为 Provider 格式
 */
export function toProviderToolDefinitions(
  tools: UnifiedToolDefinition[]
): ProviderToolDefinition[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  }));
}