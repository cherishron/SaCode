/**
 * MCP 传输层入口
 *
 * 提供多种传输层实现：Stdio、SSE、WebSocket
 */

// 类型导出
export type {
  TransportState,
  TransportEvents,
  TransportConfig,
  StdioTransportConfig,
  SSETransportConfig,
  WebSocketTransportConfig,
  ProcessInfo,
} from "./types";

export { DEFAULT_TRANSPORT_CONFIG } from "./types";

// Stdio 传输层
export { StdioTransport, createStdioTransport } from "./stdio";

// SSE 传输层
export { SSETransport, createSSETransport } from "./sse";
