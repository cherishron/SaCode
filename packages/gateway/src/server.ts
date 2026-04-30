/**
 * SACODE Gateway Server
 * 
 * 统一控制平面 - WebSocket 入口
 */

import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server as HTTPServer } from "http";
import pino from "pino";
import { v4 as uuidv4 } from "uuid";

import {
  RPCRequestSchema,
  RPCErrorCodes,
  createErrorResponse,
  createNotification,
  type RPCRequest,
  type RPCResponse,
  type RPCNotification,
  type EventType,
} from "./protocol/index.js";
import { RPCHandler, type HandlerContext, type GatewayDeps } from "./handlers/index.js";
import { SessionManager } from "./session/index.js";
import { SubscriptionManager } from "./subscription.js";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

export interface GatewayClient extends WebSocket {
  id: string;
  userId?: string;
  isAuthenticated: boolean;
  subscriptions: Set<string>;
}

export interface GatewayConfig {
  path?: string;
  heartbeatInterval?: number;
  maxConnections?: number;
  authRequired?: boolean;
  deps?: Partial<Omit<GatewayDeps, "sessionManager">>;
}

export class GatewayServer {
  private wss: WebSocketServer;
  private clients: Map<string, GatewayClient> = new Map();
  private sessionManager: SessionManager;
  private subscriptionManager: SubscriptionManager;
  private rpcHandler: RPCHandler;
  private heartbeatTimer?: NodeJS.Timeout;
  private config: Required<Omit<GatewayConfig, "deps">> & Pick<GatewayConfig, "deps">;

  constructor(server: HTTPServer, config: GatewayConfig = {}) {
    this.config = {
      path: config.path ?? "/gateway",
      heartbeatInterval: config.heartbeatInterval ?? 30000,
      maxConnections: config.maxConnections ?? 1000,
      authRequired: config.authRequired ?? true,
      deps: config.deps ?? {},
    };

    this.wss = new WebSocketServer({ server, path: this.config.path });
    this.sessionManager = new SessionManager();
    this.subscriptionManager = new SubscriptionManager();

    const handlerDeps: GatewayDeps = {
      sessionManager: this.sessionManager,
      ...config.deps,
    };
    this.rpcHandler = new RPCHandler(handlerDeps);

    this.setupHandlers();
    this.startHeartbeat();
  }

  private setupHandlers(): void {
    this.wss.on("connection", (ws: WebSocket) => {
      const client = ws as GatewayClient;
      client.id = uuidv4();
      client.isAuthenticated = !this.config.authRequired;
      client.subscriptions = new Set();

      // 检查连接数限制
      if (this.clients.size >= this.config.maxConnections) {
        this.sendToClient(client, createErrorResponse(undefined, RPCErrorCodes.RATE_LIMIT_EXCEEDED, "Maximum connections reached"));
        client.close();
        return;
      }

      this.clients.set(client.id, client);
      logger.info({ clientId: client.id }, "Client connected");

      client.on("message", (data) => this.handleMessage(client, data));
      client.on("close", () => this.handleDisconnect(client));
      client.on("error", (error) => logger.error({ clientId: client.id, error }, "WebSocket error"));

      // 发送连接确认
      this.sendToClient(client, createNotification("gateway.connected", { clientId: client.id }));
    });
  }

  private async handleMessage(client: GatewayClient, data: RawData): Promise<void> {
    let request: RPCRequest;

    // 解析消息
    try {
      const parsed = JSON.parse(data.toString());
      request = RPCRequestSchema.parse(parsed);
    } catch (error) {
      this.sendToClient(client, createErrorResponse(undefined, RPCErrorCodes.PARSE_ERROR, "Invalid JSON"));
      return;
    }

    // 认证检查（豁免 subscribe 方法）
    if (this.config.authRequired && !client.isAuthenticated && request.method !== "subscribe") {
      this.sendToClient(client, createErrorResponse(request.id, RPCErrorCodes.UNAUTHORIZED, "Authentication required"));
      return;
    }

    // 处理请求
    try {
      const context: HandlerContext = {
        client,
        userId: client.userId,
        sessionId: client.id, // 使用 client ID 作为临时 session ID
        send: (response: RPCResponse | RPCNotification) => this.sendToClient(client, response),
        broadcast: (eventType: EventType, data: unknown) => this.broadcast(eventType, data),
      };

      const response = await this.rpcHandler.handle(request, context);
      
      if (response && request.id) {
        this.sendToClient(client, response);
      }
    } catch (error) {
      logger.error({ clientId: client.id, method: request.method, error }, "Handler error");
      this.sendToClient(
        client,
        createErrorResponse(
          request.id,
          RPCErrorCodes.INTERNAL_ERROR,
          error instanceof Error ? error.message : "Internal error"
        )
      );
    }
  }

  private handleDisconnect(client: GatewayClient): void {
    this.clients.delete(client.id);
    this.subscriptionManager.unsubscribeAll(client.id);
    logger.info({ clientId: client.id }, "Client disconnected");
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [id, client] of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          this.sendToClient(client, createNotification("gateway.ping", { timestamp: Date.now() }));
        } else {
          this.clients.delete(id);
        }
      }
    }, this.config.heartbeatInterval);
  }

  private sendToClient(client: GatewayClient, message: RPCResponse | RPCNotification): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  // ============================================
  // 公共方法
  // ============================================

  /**
   * 认证客户端
   */
  authenticateClient(clientId: string, userId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.userId = userId;
      client.isAuthenticated = true;
      logger.info({ clientId, userId }, "Client authenticated");
    }
  }

  /**
   * 向所有订阅者广播事件
   */
  broadcast(eventType: EventType, data: unknown): void {
    const subscribers = this.subscriptionManager.getSubscribers(eventType);
    const notification = createNotification(eventType, { timestamp: Date.now(), data });

    for (const clientId of subscribers) {
      const client = this.clients.get(clientId);
      if (client && client.readyState === WebSocket.OPEN) {
        this.sendToClient(client, notification);
      }
    }
  }

  /**
   * 向特定用户发送消息
   */
  sendToUser(userId: string, notification: RPCNotification): void {
    for (const client of this.clients.values()) {
      if (client.userId === userId && client.readyState === WebSocket.OPEN) {
        this.sendToClient(client, notification);
      }
    }
  }

  /**
   * 获取服务器统计信息
   */
  getStats(): { connections: number; subscriptions: number; sessions: number } {
    return {
      connections: this.clients.size,
      subscriptions: this.subscriptionManager.size(),
      sessions: this.sessionManager.size(),
    };
  }

  /**
   * 关闭服务器
   */
  close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    for (const client of this.clients.values()) {
      client.close();
    }

    this.wss.close();
    logger.info("Gateway server closed");
  }
}
