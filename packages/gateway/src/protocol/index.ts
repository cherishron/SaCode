/**
 * SACODE Gateway Protocol
 * 
 * 基于 JSON-RPC 2.0 的 WebSocket 协议
 * 参考 OpenClaw Gateway 协议设计
 */

import { z } from "zod";

// ============================================
// 基础消息类型
// ============================================

export const RPCRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string().optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

export const RPCResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string().optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

export const RPCNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

export type RPCRequest = z.infer<typeof RPCRequestSchema>;
export type RPCResponse = z.infer<typeof RPCResponseSchema>;
export type RPCNotification = z.infer<typeof RPCNotificationSchema>;

// ============================================
// RPC 方法名称
// ============================================

export const RPCMethods = {
  // 会话管理
  SESSION_LIST: "session.list",
  SESSION_GET: "session.get",
  SESSION_CREATE: "session.create",
  SESSION_DELETE: "session.delete",
  SESSION_RESET: "session.reset",
  SESSION_PATCH: "session.patch",

  // Agent 调用
  AGENT_SEND: "agent.send",
  AGENT_ABORT: "agent.abort",

  // 渠道管理
  CHANNEL_LIST: "channel.list",
  CHANNEL_CONNECT: "channel.connect",
  CHANNEL_DISCONNECT: "channel.disconnect",

  // 工具调用
  TOOLS_LIST: "tools.list",
  TOOLS_EXECUTE: "tools.execute",

  // 内存管理
  MEMORY_SEARCH: "memory.search",
  MEMORY_ADD: "memory.add",

  // 配置管理
  CONFIG_GET: "config.get",
  CONFIG_SET: "config.set",

  // 系统状态
  SYSTEM_STATUS: "system.status",
  SYSTEM_HEALTH: "system.health",

  // 订阅事件
  SUBSCRIBE: "subscribe",
  UNSUBSCRIBE: "unsubscribe",
} as const;

export type RPCMethodName = (typeof RPCMethods)[keyof typeof RPCMethods];

// ============================================
// 会话相关类型
// ============================================

export const SessionTypeSchema = z.enum(["main", "dm", "group"]);

export type SessionType = z.infer<typeof SessionTypeSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  type: SessionTypeSchema,
  channel: z.string().optional(),
  chatId: z.string().optional(),
  model: z.string().optional(),
  thinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messageCount: z.number(),
  tokenCount: z.number().optional(),
});

export type Session = z.infer<typeof SessionSchema>;

// ============================================
// Agent 相关类型
// ============================================

export const AgentSendParamsSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
  deliver: z.boolean().optional(),
  thinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
});

export type AgentSendParams = z.infer<typeof AgentSendParamsSchema>;

export const AgentMessageSchema = z.object({
  type: z.enum(["text", "tool_use", "tool_result", "thinking", "error", "complete"]),
  content: z.string().optional(),
  toolName: z.string().optional(),
  toolInput: z.unknown().optional(),
  toolOutput: z.unknown().optional(),
  thinking: z.string().optional(),
  error: z.string().optional(),
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

// ============================================
// 渠道相关类型
// ============================================

export const PlatformSchema = z.enum([
  "wechat",
  "qq",
  "telegram",
  "discord",
  "dingtalk",
  "feishu",
  "xiaoyi",
  "whatsapp",
  "slack",
  "email",
]);

export type Platform = z.infer<typeof PlatformSchema>;

export const ChannelSchema = z.object({
  id: z.string(),
  platform: PlatformSchema,
  name: z.string(),
  status: z.enum(["connected", "disconnected", "connecting", "error"]),
  config: z.record(z.unknown()).optional(),
  lastConnectedAt: z.number().optional(),
});

export type Channel = z.infer<typeof ChannelSchema>;

// ============================================
// 工具相关类型
// ============================================

export const ToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()),
  enabled: z.boolean(),
});

export type Tool = z.infer<typeof ToolSchema>;

export const ToolExecuteParamsSchema = z.object({
  name: z.string(),
  input: z.record(z.unknown()),
  sessionId: z.string().optional(),
});

export type ToolExecuteParams = z.infer<typeof ToolExecuteParamsSchema>;

// ============================================
// 内存相关类型
// ============================================

export const MemorySearchParamsSchema = z.object({
  query: z.string(),
  limit: z.number().min(1).max(100).default(10),
  sessionId: z.string().optional(),
});

export type MemorySearchParams = z.infer<typeof MemorySearchParamsSchema>;

export const MemoryResultSchema = z.object({
  content: z.string(),
  score: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export type MemoryResult = z.infer<typeof MemoryResultSchema>;

// ============================================
// 事件通知类型
// ============================================

export const EventTypeSchema = z.enum([
  "agent.message",
  "agent.complete",
  "agent.error",
  "session.created",
  "session.deleted",
  "channel.connected",
  "channel.disconnected",
  "system.health",
  "system.tick",
]);

export type EventType = z.infer<typeof EventTypeSchema>;

export const EventNotificationSchema = z.object({
  type: EventTypeSchema,
  timestamp: z.number(),
  data: z.unknown(),
});

export type EventNotification = z.infer<typeof EventNotificationSchema>;

// ============================================
// 错误码定义
// ============================================

export const RPCErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // 自定义错误码
  UNAUTHORIZED: -32001,
  SESSION_NOT_FOUND: -32002,
  CHANNEL_NOT_FOUND: -32003,
  TOOL_NOT_FOUND: -32004,
  TOOL_EXECUTION_ERROR: -32005,
  RATE_LIMIT_EXCEEDED: -32006,
} as const;

export type RPCErrorCode = (typeof RPCErrorCodes)[keyof typeof RPCErrorCodes];

// ============================================
// 辅助函数
// ============================================

export function createRequest(
  method: string,
  params?: Record<string, unknown>,
  id?: string
): RPCRequest {
  return {
    jsonrpc: "2.0",
    id: id ?? generateId(),
    method,
    params,
  };
}

export function createResponse(id: string | undefined, result: unknown): RPCResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

export function createErrorResponse(
  id: string | undefined,
  code: number,
  message: string,
  data?: unknown
): RPCResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, data },
  };
}

export function createNotification(method: string, params?: Record<string, unknown>): RPCNotification {
  return {
    jsonrpc: "2.0",
    method,
    params,
  };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
