import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server } from "http";
import { EventEmitter } from "events";
import { SACODEClient } from "@SACODE/core";
import { connectionEvents } from "../routes/im.js";

interface WebSocketClient extends WebSocket {
  userId?: string;
  sessionId?: string;
  subscriptions?: Set<string>; // 订阅的事件类型
}

interface WebSocketMessage {
  type: string;
  payload: unknown;
}

interface ChatPayload {
  message: string;
  sessionId?: string;
  mode?: "chat" | "agentic"; // 聊天模式：chat（默认）或 agentic（带自动规划）
}

// 会话事件订阅类型
interface SessionSubscription {
  sessionIds: string[];
}

// 全局事件发射器，用于外部模块推送消息
export const wsEvents = new EventEmitter();

export class SACODEWebSocketServer {
  private wss: WebSocketServer;
  private clients: Map<string, WebSocketClient[]> = new Map();
  private SACODEClients: Map<string, SACODEClient> = new Map();
  private imSubscribers: Set<WebSocketClient> = new Set();
  private sessionSubscribers: Map<string, Set<WebSocketClient>> = new Map(); // sessionId -> clients

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.setupHandlers();
    this.setupIMEventForwarding();
    this.setupExternalEventHandlers();
  }

  private setupHandlers(): void {
    this.wss.on("connection", (ws: WebSocketClient) => {
      console.log("[WS] Client connected");
      ws.subscriptions = new Set();

      ws.on("message", (data: RawData) => {
        this.handleMessage(ws, data);
      });

      ws.on("close", () => {
        this.handleDisconnect(ws);
      });

      ws.on("error", (error) => {
        console.error("[WS] Error:", error);
      });

      // 发送欢迎消息
      ws.send(JSON.stringify({ type: "connected", timestamp: Date.now() }));
    });
  }

  private setupIMEventForwarding(): void {
    // 转发 IM 连接状态变更
    connectionEvents.on("status", (data) => {
      this.broadcastIM({
        type: "im:status",
        data: {
          connectionId: data.connectionId,
          status: data.status,
          platform: data.platform,
          error: data.error,
          timestamp: Date.now(),
        },
      });
    });

    // 转发 IM 连接日志
    connectionEvents.on("log", (log) => {
      this.broadcastIM({
        type: "im:log",
        data: log,
      });
    });
  }

  // 外部事件处理器 - 允许其他模块推送消息
  private setupExternalEventHandlers(): void {
    // 会话事件
    wsEvents.on("session:created", (data) => {
      this.broadcast(data.userId, { type: "session:created", data });
    });

    wsEvents.on("session:updated", (data) => {
      this.broadcast(data.userId, { type: "session:updated", data });
      this.broadcastToSessionSubscribers(data.sessionId, {
        type: "session:updated",
        data,
      });
    });

    wsEvents.on("session:deleted", (data) => {
      this.broadcast(data.userId, { type: "session:deleted", data });
    });

    // 消息事件
    wsEvents.on("message:created", (data) => {
      this.broadcast(data.userId, { type: "message:created", data });
      this.broadcastToSessionSubscribers(data.sessionId, {
        type: "message:created",
        data,
      });
    });

    wsEvents.on("message:updated", (data) => {
      this.broadcastToSessionSubscribers(data.sessionId, {
        type: "message:updated",
        data,
      });
    });

    wsEvents.on("message:deleted", (data) => {
      this.broadcastToSessionSubscribers(data.sessionId, {
        type: "message:deleted",
        data,
      });
    });

    // 批量操作事件
    wsEvents.on("batch:delete:sessions", (data) => {
      this.broadcast(data.userId, { type: "batch:delete:sessions", data });
    });

    wsEvents.on("batch:delete:messages", (data) => {
      this.broadcast(data.userId, { type: "batch:delete:messages", data });
    });

    wsEvents.on("batch:update:sessions", (data) => {
      this.broadcast(data.userId, { type: "batch:update:sessions", data });
    });

    // 系统通知
    wsEvents.on("system:notification", (data) => {
      this.broadcastAll({ type: "system:notification", data });
    });

    // 模型切换事件
    wsEvents.on("model:switched", (data) => {
      this.broadcast(data.userId, { type: "model:switched", data });
    });

    // 通知事件
    wsEvents.on("notification:created", (data) => {
      this.broadcast(data.userId, {
        type: "notification:created",
        data: data.notification,
      });
    });
  }

  private broadcastIM(message: unknown): void {
    const data = JSON.stringify(message);
    for (const client of this.imSubscribers) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private broadcastToSessionSubscribers(sessionId: string, message: unknown): void {
    const subscribers = this.sessionSubscribers.get(sessionId);
    if (!subscribers) return;

    const data = JSON.stringify(message);
    for (const client of subscribers) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private async handleMessage(ws: WebSocketClient, data: RawData): Promise<void> {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());

      switch (message.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          break;

        case "subscribe":
          this.handleSubscribe(ws, message.payload as { userId: string });
          break;

        case "unsubscribe":
          this.handleUnsubscribe(ws);
          break;

        case "im:subscribe":
          this.handleIMSubscribe(ws);
          break;

        case "im:unsubscribe":
          this.handleIMUnsubscribe(ws);
          break;

        case "session:subscribe":
          this.handleSessionSubscribe(ws, message.payload as SessionSubscription);
          break;

        case "session:unsubscribe":
          this.handleSessionUnsubscribe(ws, message.payload as SessionSubscription);
          break;

        case "chat":
          await this.handleChat(ws, message.payload as ChatPayload);
          break;

        default:
          ws.send(
            JSON.stringify({
              type: "error",
              error: `Unknown message type: ${(message as { type: string }).type}`,
            })
          );
      }
    } catch (error) {
      console.error("[WS] Parse error:", error);
      ws.send(JSON.stringify({ type: "error", error: "Invalid message format" }));
    }
  }

  private handleSubscribe(ws: WebSocketClient, payload: { userId: string }): void {
    ws.userId = payload.userId;

    // 添加到客户端列表
    const userClients = this.clients.get(payload.userId) || [];
    userClients.push(ws);
    this.clients.set(payload.userId, userClients);

    ws.send(JSON.stringify({ type: "subscribed", userId: payload.userId }));
  }

  private handleUnsubscribe(ws: WebSocketClient): void {
    if (ws.userId) {
      const userClients = this.clients.get(ws.userId) || [];
      const index = userClients.indexOf(ws);
      if (index > -1) {
        userClients.splice(index, 1);
      }
      this.clients.set(ws.userId, userClients);
    }
  }

  private handleIMSubscribe(ws: WebSocketClient): void {
    this.imSubscribers.add(ws);
    ws.send(JSON.stringify({ type: "im:subscribed", timestamp: Date.now() }));
  }

  private handleIMUnsubscribe(ws: WebSocketClient): void {
    this.imSubscribers.delete(ws);
    ws.send(JSON.stringify({ type: "im:unsubscribed", timestamp: Date.now() }));
  }

  private handleSessionSubscribe(ws: WebSocketClient, payload: SessionSubscription): void {
    if (!payload.sessionIds || !Array.isArray(payload.sessionIds)) return;

    for (const sessionId of payload.sessionIds) {
      let subscribers = this.sessionSubscribers.get(sessionId);
      if (!subscribers) {
        subscribers = new Set();
        this.sessionSubscribers.set(sessionId, subscribers);
      }
      subscribers.add(ws);
    }

    ws.subscriptions?.add("session");
    ws.send(
      JSON.stringify({
        type: "session:subscribed",
        sessionIds: payload.sessionIds,
        timestamp: Date.now(),
      })
    );
  }

  private handleSessionUnsubscribe(ws: WebSocketClient, payload: SessionSubscription): void {
    if (!payload.sessionIds || !Array.isArray(payload.sessionIds)) {
      // 如果没有指定，取消所有会话订阅
      for (const [sessionId, subscribers] of this.sessionSubscribers) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          this.sessionSubscribers.delete(sessionId);
        }
      }
    } else {
      for (const sessionId of payload.sessionIds) {
        const subscribers = this.sessionSubscribers.get(sessionId);
        if (subscribers) {
          subscribers.delete(ws);
          if (subscribers.size === 0) {
            this.sessionSubscribers.delete(sessionId);
          }
        }
      }
    }

    ws.send(
      JSON.stringify({
        type: "session:unsubscribed",
        timestamp: Date.now(),
      })
    );
  }

  private async handleChat(ws: WebSocketClient, payload: ChatPayload): Promise<void> {
    if (!ws.userId) {
      ws.send(JSON.stringify({ type: "error", error: "Not subscribed" }));
      return;
    }

    const mode = payload.mode || "chat";

    try {
      // 获取或创建 SACODE 客户端（根据模式使用不同的 key）
      const clientKey = `${ws.userId}-${mode}`;
      let client = this.SACODEClients.get(clientKey);
      if (!client) {
        // 构建配置对象（避免 exactOptionalPropertyTypes 问题）
        const clientConfig: {
          provider?: {
            type: "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu";
            apiKey: string;
            model?: string;
            baseUrl?: string;
            timeout?: number;
          };
          maxToolLoopIterations: number;
          enableAgenticPlanning: boolean;
          debug?: boolean;
        } = {
          maxToolLoopIterations: parseInt(process.env.MAX_TOOL_LOOP_ITERATIONS || "10", 10),
          enableAgenticPlanning: mode === "agentic",
        };

        if (process.env.AI_PROVIDER) {
          const providerConfig: {
            type: "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu";
            apiKey: string;
            model?: string;
            baseUrl?: string;
            timeout?: number;
          } = {
            type: process.env.AI_PROVIDER as "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu",
            apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || "",
          };
          if (process.env.AI_MODEL) {
            providerConfig.model = process.env.AI_MODEL;
          }
          if (process.env.AI_BASE_URL) {
            providerConfig.baseUrl = process.env.AI_BASE_URL;
          }
          const timeout = parseInt(process.env.AI_TIMEOUT || "60000", 10);
          if (timeout) {
            providerConfig.timeout = timeout;
          }
          clientConfig.provider = providerConfig;
        }

        if (process.env.NODE_ENV === "development") {
          clientConfig.debug = true;
        }

        client = new SACODEClient(clientConfig);
        await client.connect();
        this.SACODEClients.set(clientKey, client);
      }

      // 发送开始信号
      ws.send(JSON.stringify({ type: "chat:start", mode, sessionId: payload.sessionId }));

      // 根据模式选择聊天方法
      if (mode === "agentic") {
        // Agentic 模式：带自动规划
        for await (const msg of client.agenticChat(payload.message, payload.sessionId)) {
          if ("type" in msg && typeof msg.type === "string") {
            // Agentic 事件（规划、步骤执行等）
            ws.send(
              JSON.stringify({
                type: "chat:event",
                eventType: msg.type,
                data: msg,
              })
            );
          } else {
            // 普通消息
            ws.send(
              JSON.stringify({
                type: "chat:message",
                message: msg,
              })
            );
          }
        }
      } else {
        // 普通模式：流式响应
        for await (const msg of client.chat(payload.message, payload.sessionId)) {
          ws.send(
            JSON.stringify({
              type: "chat:message",
              message: msg,
            })
          );
        }
      }

      // 发送完成信号
      ws.send(JSON.stringify({ type: "chat:complete", mode, sessionId: payload.sessionId }));
    } catch (error) {
      console.error("[WS] Chat error:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : "Chat error",
        })
      );
    }
  }

  private handleDisconnect(ws: WebSocketClient): void {
    console.log("[WS] Client disconnected");

    // 清理订阅
    this.handleUnsubscribe(ws);

    // 清理 IM 订阅
    this.imSubscribers.delete(ws);

    // 清理会话订阅
    for (const [sessionId, subscribers] of this.sessionSubscribers) {
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        this.sessionSubscribers.delete(sessionId);
      }
    }

    // 清理 SACODE 客户端
    if (ws.userId) {
      const client = this.SACODEClients.get(ws.userId);
      if (client) {
        client.disconnect();
        this.SACODEClients.delete(ws.userId);
      }
    }
  }

  // 向特定用户广播
  broadcast(userId: string, message: unknown): void {
    const userClients = this.clients.get(userId) || [];
    const data = JSON.stringify(message);

    for (const client of userClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  // 向所有用户广播
  broadcastAll(message: unknown): void {
    const data = JSON.stringify(message);
    for (const clients of this.clients.values()) {
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      }
    }
  }

  // 发送系统通知
  sendSystemNotification(
    type: "info" | "warning" | "error" | "success",
    message: string,
    userId?: string
  ): void {
    const notification = {
      type: "system:notification",
      data: {
        notificationType: type,
        message,
        timestamp: Date.now(),
      },
    };

    if (userId) {
      this.broadcast(userId, notification);
    } else {
      this.broadcastAll(notification);
    }
  }

  close(): void {
    // 关闭所有 SACODE 客户端
    for (const client of this.SACODEClients.values()) {
      client.disconnect();
    }

    // 关闭 WebSocket 服务器
    this.wss.close();

    // 移除所有事件监听
    wsEvents.removeAllListeners();
  }
}
