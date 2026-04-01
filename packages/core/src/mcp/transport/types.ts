/**
 * MCP 传输层类型定义
 */

import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../protocol";

/**
 * 传输层状态
 */
export type TransportState = "disconnected" | "connecting" | "connected" | "error";

/**
 * 传输层事件
 */
export interface TransportEvents {
  connected: [];
  disconnected: [];
  error: [error: Error];
  message: [message: JsonRpcResponse | JsonRpcNotification];
  stateChange: [state: TransportState];
}

/**
 * 传输层配置
 */
export interface TransportConfig {
  /** 连接超时（毫秒） */
  connectTimeout: number;
  /** 请求超时（毫秒） */
  requestTimeout: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试延迟（毫秒） */
  retryDelay: number;
}

/**
 * 默认传输层配置
 */
export const DEFAULT_TRANSPORT_CONFIG: TransportConfig = {
  connectTimeout: 30000,
  requestTimeout: 60000,
  maxRetries: 3,
  retryDelay: 1000,
};

/**
 * Stdio 传输层配置
 */
export interface StdioTransportConfig extends TransportConfig {
  /** 命令 */
  command: string;
  /** 命令参数 */
  args: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  cwd?: string;
}

/**
 * SSE 传输层配置
 */
export interface SSETransportConfig extends TransportConfig {
  /** 服务器 URL */
  url: string;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 是否自动重连 */
  autoReconnect: boolean;
  /** 重连延迟（毫秒） */
  reconnectDelay: number;
  /** 最大重连次数 */
  maxReconnectAttempts: number;
}

/**
 * WebSocket 传输层配置
 */
export interface WebSocketTransportConfig extends TransportConfig {
  /** WebSocket URL */
  url: string;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 是否自动重连 */
  autoReconnect: boolean;
  /** 重连延迟（毫秒） */
  reconnectDelay: number;
  /** 心跳间隔（毫秒） */
  heartbeatInterval?: number;
}

/**
 * 进程信息（用于 Stdio 传输层）
 */
export interface ProcessInfo {
  pid: number;
  command: string;
  args: string[];
  startedAt: Date;
}
