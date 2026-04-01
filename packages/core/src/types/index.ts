import { z } from "zod";

// ============================================================================
// 从 @saclaw/types 重新导出共享类型
// ============================================================================

import type {
  MessageContentType as _MessageContentType,
  ImageContent as _ImageContent,
  AudioContent as _AudioContent,
  VideoContent as _VideoContent,
  FileContent as _FileContent,
  LocationContent as _LocationContent,
  StickerContent as _StickerContent,
  TextContent as _TextContent,
  MessageContent as _MessageContent,
  IMConfig as _IMConfig,
  Channel as _Channel,
  IMMessage as _IMMessage,
  IMAdapter as _IMAdapter,
  Platform as _Platform,
} from "@saclaw/types";

export type {
  MessageContentType,
  ImageContent,
  AudioContent,
  VideoContent,
  FileContent,
  LocationContent,
  StickerContent,
  TextContent,
  MessageContent,
  IMConfig,
  Channel,
  IMMessage,
  IMAdapter,
} from "@saclaw/types";

// 重命名导出以避免与 session/types.ts 中的 Platform 冲突
export type { Platform as IMPlatform } from "@saclaw/types";

// 本地类型别名，用于当前文件
type MessageContent = _MessageContent;

export {
  isTextContent,
  isImageContent,
  isAudioContent,
  isVideoContent,
  isFileContent,
  isLocationContent,
  isStickerContent,
} from "@saclaw/types";

// ============================================================================
// 配置类型
// ============================================================================

export const IFlowConfigSchema = z.object({
  acpUrl: z.string().default("ws://localhost:8090/acp"),
  autoStart: z.boolean().default(true),
  timeout: z.number().default(60000),
  mcpServers: z
    .array(
      z.object({
        name: z.string(),
        command: z.string(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
      })
    )
    .optional(),
  hooks: z.record(z.unknown()).optional(),
  agents: z
    .array(
      z.object({
        agentType: z.string(),
        whenToUse: z.string(),
        allowedTools: z.array(z.string()).optional(),
        systemPrompt: z.string().optional(),
      })
    )
    .optional(),
});

export type IFlowConfig = z.infer<typeof IFlowConfigSchema>;

// ============================================================================
// 消息类型
// ============================================================================

export const MessageRole = {
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
  TOOL: "tool",
} as const;

export type MessageRoleType = (typeof MessageRole)[keyof typeof MessageRole];

export interface MessageChunk {
  text: string;
  index?: number;
  isComplete?: boolean;
}

export interface AgentInfo {
  agentId: string;
  agentIndex: number | undefined;
  taskId: string | undefined;
  timestamp: number | undefined;
}

export interface BaseMessage {
  id: string;
  role: MessageRoleType;
  timestamp: Date;
  channelId: string | undefined;
}

// ============================================
// 消息接口 (使用 @saclaw/types 中的 MessageContent)
// ============================================

export interface UserMessage extends BaseMessage {
  role: "user";
  content: string;
  /** 多媒体内容列表 */
  contents?: MessageContent[] | undefined;
}

export interface AssistantMessage extends BaseMessage {
  role: "assistant";
  chunk: MessageChunk;
  agentInfo: AgentInfo | undefined;
}

export interface ToolCallMessage extends BaseMessage {
  role: "tool";
  toolName: string;
  status: "pending" | "running" | "success" | "error";
  label: string | undefined;
  agentInfo: AgentInfo | undefined;
}

export interface PlanEntry {
  content: string;
  priority: number;
  status: "pending" | "running" | "completed" | "failed";
}

export interface PlanMessage extends BaseMessage {
  role: "system";
  entries: PlanEntry[];
}

export interface TaskFinishMessage extends BaseMessage {
  role: "system";
  stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "error" | "tool_use";
}

export interface ErrorMessage extends BaseMessage {
  role: "system";
  code: string;
  message: string;
}

export type Message =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | PlanMessage
  | TaskFinishMessage
  | ErrorMessage;

// ============================================================================
// 会话类型 - 重新导出自 session/types.ts
// ============================================================================

// 重新导出会话相关类型，保持向后兼容性
export type {
  SessionStatus,
  Session,
  SessionCreateOptions,
  SessionUpdateOptions,
  ChannelIdentifier,
  Platform,
  SessionMappingEntry,
  SessionMapperConfig,
  SessionMapperEvents,
  SessionManagerConfig,
  SessionManagerEvents,
  ParseChannel,
  BuildChannel,
} from "../session/types";

// ============================================================================
// 事件类型
// ============================================================================

export const SaClawEventType = {
  MESSAGE: "message",
  SESSION_CREATE: "session:create",
  SESSION_UPDATE: "session:update",
  SESSION_CLOSE: "session:close",
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  ERROR: "error",
} as const;

export type SaClawEventTypeType = (typeof SaClawEventType)[keyof typeof SaClawEventType];

export interface SaClawEvent {
  type: SaClawEventTypeType;
  payload: unknown;
  timestamp: Date;
}

// ============================================================================
// 错误类型
// ============================================================================

export class SaClawError extends Error {
  override name = "SaClawError";
  public code: string;

  constructor(code: string, message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.code = code;
  }
}

export class ConnectionError extends SaClawError {
  override name = "ConnectionError";

  constructor(message: string, cause?: Error) {
    super("CONNECTION_ERROR", message, cause);
  }
}

export class TimeoutError extends SaClawError {
  override name = "TimeoutError";

  constructor(message: string, cause?: Error) {
    super("TIMEOUT_ERROR", message, cause);
  }
}

export class SessionError extends SaClawError {
  override name = "SessionError";

  constructor(message: string, cause?: Error) {
    super("SESSION_ERROR", message, cause);
  }
}

// ============================================================================
// Provider 类型 - 重新导出自 provider/types.ts
// ============================================================================

// 重新导出 Provider 相关类型，保持向后兼容性
export type {
  AIProvider,
  AnthropicProviderConfig,
  BaseProviderConfig,
  ChatCompletionOptions,
  ChatMessage,
  ChatMessageContent,
  OpenAIProviderConfig,
  ProviderConfig,
  ProviderType,
  StreamChunk,
  ToolCall,
  ToolCallResult,
  ToolDefinition,
} from "../provider/types";

export {
  APIKeyError,
  ModelNotAvailableError,
  PROVIDER_TYPES,
  ProviderError,
  RateLimitError,
} from "../provider/types";

// ============================================================================
// SaClaw 客户端配置（新版 - 支持 Provider）
// ============================================================================

/**
 * SaClaw 客户端配置
 *
 * 支持两种配置模式：
 * 1. Provider 模式（推荐）：通过 provider 字段配置 AI 服务
 * 2. Legacy 模式（兼容）：通过 acpUrl 配置 iFlow ACP 服务
 */
export const SaClawClientConfigSchema = z.object({
  // Provider 模式配置
  provider: z
    .object({
      type: z.enum(["openai", "anthropic", "deepseek", "moonshot", "zhipu"]),
      apiKey: z.string(),
      model: z.string().optional(),
      baseUrl: z.string().optional(),
      timeout: z.number().optional(),
      maxRetries: z.number().optional(),
      debug: z.boolean().optional(),
    })
    .optional(),

  // Legacy iFlow 配置（向后兼容）
  acpUrl: z.string().optional(),
  autoStart: z.boolean().optional(),
  timeout: z.number().optional(),
  mcpServers: z
    .array(
      z.object({
        name: z.string(),
        command: z.string(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
      })
    )
    .optional(),
  hooks: z.record(z.unknown()).optional(),
  agents: z
    .array(
      z.object({
        agentType: z.string(),
        whenToUse: z.string(),
        allowedTools: z.array(z.string()).optional(),
        systemPrompt: z.string().optional(),
      })
    )
    .optional(),

  // 调试模式
  debug: z.boolean().optional(),
});

export type SaClawClientConfig = z.infer<typeof SaClawClientConfigSchema>;
