/**
 * SSE (Server-Sent Events) 传输层实现
 *
 * 通过 HTTP SSE 与服务器通信
 */

import EventEmitter from "eventemitter3";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  MCPTransport,
} from "../protocol";
import type {
  TransportState,
  TransportEvents,
  SSETransportConfig,
} from "./types";
import { DEFAULT_TRANSPORT_CONFIG } from "./types";

/**
 * SSE 传输层
 *
 * 通过 Server-Sent Events 接收消息，通过 HTTP POST 发送消息
 *
 * @example
 * ```typescript
 * const transport = new SSETransport({
 *   url: "http://localhost:3000/mcp",
 * });
 *
 * await transport.connect();
 * const response = await transport.sendRequest({
 *   jsonrpc: "2.0",
 *   id: 1,
 *   method: "tools/list",
 * });
 * ```
 */
export class SSETransport
  extends EventEmitter<TransportEvents>
  implements MCPTransport
{
  private config: SSETransportConfig;
  private eventSource: EventSource | null = null;
  private pendingRequests: Map<
    string | number,
    {
      resolve: (response: JsonRpcResponse) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  private state: TransportState = "disconnected";
  private reconnectAttempts: number = 0;
  private messageEndpoint: string;

  constructor(config: Partial<SSETransportConfig> & { url: string }) {
    super();
    this.config = {
      ...DEFAULT_TRANSPORT_CONFIG,
      autoReconnect: true,
      reconnectDelay: 3000,
      maxReconnectAttempts: 5,
      ...config,
    } as SSETransportConfig;

    // 消息发送端点（默认为 /message）
    const baseUrl = this.config.url.replace(/\/$/, "");
    this.messageEndpoint = `${baseUrl}/message`;
  }

  /**
   * 连接到 SSE 服务器
   */
  async connect(): Promise<void> {
    if (this.state === "connected") {
      return;
    }

    this.setState("connecting");

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout after ${this.config.connectTimeout}ms`));
        this.cleanup();
      }, this.config.connectTimeout);

      try {
        // 创建 EventSource 连接
        this.eventSource = new EventSource(this.config.url);

        this.eventSource.onopen = () => {
          clearTimeout(timeout);
          this.reconnectAttempts = 0;
          this.setState("connected");
          resolve();
        };

        this.eventSource.onerror = (error) => {
          clearTimeout(timeout);

          if (this.state === "connecting") {
            reject(new Error("Failed to connect to SSE server"));
          }

          this.handleConnectionError();
        };

        this.eventSource.onmessage = (event) => {
          this.handleMessage(event);
        };

        // 监听特定事件类型
        this.eventSource.addEventListener("message", (event) => {
          this.handleMessage(event as MessageEvent);
        });

        this.eventSource.addEventListener("response", (event) => {
          this.handleMessage(event as MessageEvent);
        });
      } catch (error) {
        clearTimeout(timeout);
        this.setState("error");
        reject(error);
      }
    });
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.cleanup();
  }

  /**
   * 发送请求
   */
  async sendRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (this.state !== "connected") {
      throw new Error("Transport not connected");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request timeout after ${this.config.requestTimeout}ms`));
      }, this.config.requestTimeout);

      this.pendingRequests.set(request.id, { resolve, reject, timeout });

      // 通过 HTTP POST 发送请求
      fetch(this.messageEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
        body: JSON.stringify(request),
      }).catch((error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(request.id);
        reject(error);
      });
    });
  }

  /**
   * 发送通知
   */
  async sendNotification(notification: JsonRpcNotification): Promise<void> {
    if (this.state !== "connected") {
      throw new Error("Transport not connected");
    }

    const response = await fetch(this.messageEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.config.headers,
      },
      body: JSON.stringify(notification),
    });

    if (!response.ok) {
      throw new Error(`Failed to send notification: ${response.status}`);
    }
  }

  /**
   * 获取传输层状态
   */
  getState(): TransportState {
    return this.state;
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const data = typeof event.data === "string" ? event.data : "";
      const message = JSON.parse(data) as JsonRpcResponse | JsonRpcNotification;

      // 检查是否为响应
      if ("id" in message && message.id !== undefined) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);
          pending.resolve(message as JsonRpcResponse);
        }
      } else {
        // 通知消息
        this.emit("message", message);
      }
    } catch (error) {
      console.error(`Failed to parse SSE message:`, error);
    }
  }

  /**
   * 处理连接错误
   */
  private handleConnectionError(): void {
    this.setState("error");
    this.emit("error", new Error("SSE connection error"));

    // 自动重连
    if (
      this.config.autoReconnect &&
      this.reconnectAttempts < this.config.maxReconnectAttempts
    ) {
      this.reconnectAttempts++;
      console.log(
        `Attempting to reconnect (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})...`
      );

      setTimeout(() => {
        this.connect().catch((error) => {
          console.error("Reconnection failed:", error);
        });
      }, this.config.reconnectDelay);
    }
  }

  /**
   * 设置状态
   */
  private setState(state: TransportState): void {
    if (this.state !== state) {
      this.state = state;
      this.emit("stateChange", state);
    }
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // 拒绝所有待处理的请求
    for (const [id, { reject, timeout }] of this.pendingRequests) {
      clearTimeout(timeout);
      reject(new Error("Transport disconnected"));
    }
    this.pendingRequests.clear();

    this.setState("disconnected");
  }
}

/**
 * 创建 SSE 传输层实例
 */
export function createSSETransport(
  config: Partial<SSETransportConfig> & { url: string }
): SSETransport {
  return new SSETransport(config);
}
