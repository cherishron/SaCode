/**
 * WebSocket 客户端 - 支持流式聊天和 IM 状态推送
 */

export type WebSocketStatus = "connecting" | "connected" | "disconnected" | "error";

export interface ChatMessage {
  type: "chat:message" | "chat:complete" | "chat:error" | "chat:start" | "chat:event";
  message?: string;
  content?: string;
  error?: string;
  timestamp?: number;
  eventType?: string;
  data?: unknown;
}

export interface IMStatusMessage {
  type: "im:status";
  data: {
    connectionId: string;
    status: "connected" | "disconnected" | "error";
    platform: string;
    error?: string;
    timestamp: number;
  };
}

export interface IMLogMessage {
  type: "im:log";
  data: {
    id: string;
    connectionId: string;
    type: "connect" | "disconnect" | "test" | "error" | "message";
    message: string;
    timestamp: string;
    details?: Record<string, unknown>;
  };
}

export interface StreamingMessage {
  id: string;
  content: string;
  isComplete: boolean;
}

type MessageHandler = (message: ChatMessage | IMStatusMessage | IMLogMessage) => void;
type StatusHandler = (status: WebSocketStatus) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private status: WebSocketStatus = "disconnected";
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private imSubscribed = false;

  constructor(url?: string) {
    this.url = url || this.getDefaultUrl();
  }

  private getDefaultUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.setStatus("connecting");

      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log("[WS] Connected");
          this.setStatus("connected");
          this.reconnectAttempts = 0;
          this.startPing();
          // 重新订阅 IM 事件
          if (this.imSubscribed) {
            this.subscribeIM();
          }
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as ChatMessage | IMStatusMessage | IMLogMessage;
            this.messageHandlers.forEach((handler) => handler(message));
          } catch (error) {
            console.error("[WS] Parse error:", error);
          }
        };

        this.ws.onerror = (error) => {
          console.error("[WS] Error:", error);
          this.setStatus("error");
          reject(error);
        };

        this.ws.onclose = () => {
          console.log("[WS] Disconnected");
          this.setStatus("disconnected");
          this.stopPing();
          this.attemptReconnect();
        };
      } catch (error) {
        this.setStatus("error");
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("disconnected");
    this.imSubscribed = false;
  }

  private setStatus(status: WebSocketStatus): void {
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status));
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * this.reconnectAttempts;

      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

      setTimeout(() => {
        this.connect().catch(() => {
          // 重连失败，继续尝试
        });
      }, delay);
    }
  }

  subscribe(userId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", payload: { userId } }));
    }
  }

  unsubscribe(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "unsubscribe" }));
    }
  }

  // IM 状态订阅
  subscribeIM(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "im:subscribe" }));
      this.imSubscribed = true;
    }
  }

  unsubscribeIM(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "im:unsubscribe" }));
      this.imSubscribed = false;
    }
  }

  sendChatMessage(message: string, sessionId?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "chat",
          payload: { message, sessionId },
        })
      );
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  getStatus(): WebSocketStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  isIMSubscribed(): boolean {
    return this.imSubscribed;
  }
}

// 单例实例
let wsClient: WebSocketClient | null = null;

export function getWebSocketClient(): WebSocketClient {
  if (!wsClient) {
    wsClient = new WebSocketClient();
  }
  return wsClient;
}
