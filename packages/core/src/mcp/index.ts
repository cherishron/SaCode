/**
 * MCP (Model Context Protocol) 模块
 */

export {
  // 服务器和客户端
  MCPServer,
  MCPClient,
  createMCPServer,
  createMCPClient,
  BuiltInTools,

  // 常量
  MCP_VERSION,

  // 类型
  type MCPServerOptions,
  type MCPServerEvent,
  type MCPClientOptions,
  type MCPTransport,
  type ToolHandler,
  type ResourceHandler,
  type PromptHandler,

  // JSON-RPC 类型
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,

  // MCP 类型
  type Implementation,
  type ServerCapabilities,
  type ClientCapabilities,
  type InitializeResult,
  type Tool,
  type ToolResult,
  type Resource,
  type ResourceContents,
  type Prompt,
  type PromptMessage,
  type GetPromptResult,
} from "./protocol.js";

// 导出 Schema 用于验证
export {
  ImplementationSchema,
  ServerCapabilitiesSchema,
  ClientCapabilitiesSchema,
  InitializeResultSchema,
  ToolSchema,
  ToolResultSchema,
  ResourceSchema,
  ResourceContentsSchema,
  PromptSchema,
  PromptMessageSchema,
  GetPromptResultSchema,
} from "./protocol.js";

// 传输层导出
export {
  // 类型
  type TransportState,
  type TransportEvents,
  type TransportConfig,
  type StdioTransportConfig,
  type SSETransportConfig,
  type WebSocketTransportConfig,
  type ProcessInfo,

  // 常量
  DEFAULT_TRANSPORT_CONFIG,

  // Stdio 传输层
  StdioTransport,
  createStdioTransport,

  // SSE 传输层
  SSETransport,
  createSSETransport,
} from "./transport/index.js";
