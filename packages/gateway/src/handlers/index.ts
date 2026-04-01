/**
 * RPC 处理器
 */

import {
  RPCMethods,
  type RPCRequest,
  type RPCResponse,
  type RPCNotification,
  type EventType,
  type Session,
  type AgentSendParams,
  type Channel,
  type Tool,
  type MemorySearchParams,
  type MemoryResult,
} from "../protocol/index.js";
import type { GatewayClient } from "../server.js";
import type { SessionManager } from "../session/index.js";

export interface HandlerContext {
  client: GatewayClient;
  userId: string | undefined;
  sessionId: string;
  send: (response: RPCResponse | RPCNotification) => void;
  broadcast: (eventType: EventType, data: unknown) => void;
}

type RPCHandlerFn = (params: Record<string, unknown>, context: HandlerContext) => Promise<unknown | void>;

export class RPCHandler {
  private handlers: Map<string, RPCHandlerFn> = new Map();
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    // 会话管理
    this.register(RPCMethods.SESSION_LIST, this.sessionList.bind(this));
    this.register(RPCMethods.SESSION_GET, this.sessionGet.bind(this));
    this.register(RPCMethods.SESSION_CREATE, this.sessionCreate.bind(this));
    this.register(RPCMethods.SESSION_DELETE, this.sessionDelete.bind(this));
    this.register(RPCMethods.SESSION_RESET, this.sessionReset.bind(this));

    // Agent 调用
    this.register(RPCMethods.AGENT_SEND, this.agentSend.bind(this));
    this.register(RPCMethods.AGENT_ABORT, this.agentAbort.bind(this));

    // 渠道管理
    this.register(RPCMethods.CHANNEL_LIST, this.channelList.bind(this));
    this.register(RPCMethods.CHANNEL_CONNECT, this.channelConnect.bind(this));
    this.register(RPCMethods.CHANNEL_DISCONNECT, this.channelDisconnect.bind(this));

    // 工具
    this.register(RPCMethods.TOOLS_LIST, this.toolsList.bind(this));
    this.register(RPCMethods.TOOLS_EXECUTE, this.toolsExecute.bind(this));

    // 内存
    this.register(RPCMethods.MEMORY_SEARCH, this.memorySearch.bind(this));

    // 系统
    this.register(RPCMethods.SYSTEM_STATUS, this.systemStatus.bind(this));
  }

  private register(method: string, handler: RPCHandlerFn): void {
    this.handlers.set(method, handler);
  }

  async handle(request: RPCRequest, context: HandlerContext): Promise<RPCResponse | null> {
    const handler = this.handlers.get(request.method);
    
    if (!handler) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      };
    }

    const result = await handler(request.params ?? {}, context);

    // 如果没有结果（如流式响应），返回 null
    if (result === undefined && request.method === RPCMethods.AGENT_SEND) {
      return null;
    }

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: result ?? null,
    };
  }

  // ============================================
  // 会话管理
  // ============================================

  private async sessionList(_params: Record<string, unknown>, context: HandlerContext): Promise<Session[]> {
    const userId = context.userId;
    if (!userId) throw new Error("User not authenticated");

    return this.sessionManager.listByUser(userId);
  }

  private async sessionGet(params: Record<string, unknown>): Promise<Session | null> {
    const sessionId = params.sessionId as string | undefined;
    if (!sessionId) throw new Error("sessionId required");

    return this.sessionManager.get(sessionId);
  }

  private async sessionCreate(params: Record<string, unknown>, context: HandlerContext): Promise<Session> {
    const userId = context.userId;
    if (!userId) throw new Error("User not authenticated");

    const session = await this.sessionManager.create({
      userId,
      type: (params.type as "main" | "dm" | "group") ?? "main",
      channel: params.channel as string | undefined,
      chatId: params.chatId as string | undefined,
      model: params.model as string | undefined,
    });

    context.broadcast("session.created", session);
    return session;
  }

  private async sessionDelete(params: Record<string, unknown>, context: HandlerContext): Promise<{ success: boolean }> {
    const sessionId = params.sessionId as string | undefined;
    if (!sessionId) throw new Error("sessionId required");

    await this.sessionManager.delete(sessionId);
    context.broadcast("session.deleted", { sessionId });

    return { success: true };
  }

  private async sessionReset(params: Record<string, unknown>): Promise<Session> {
    const sessionId = params.sessionId as string | undefined;
    if (!sessionId) throw new Error("sessionId required");

    return this.sessionManager.reset(sessionId);
  }

  // ============================================
  // Agent 调用
  // ============================================

  private async agentSend(params: Record<string, unknown>, context: HandlerContext): Promise<void> {
    const { sessionId, message } = params as AgentSendParams;
    if (!sessionId || !message) throw new Error("sessionId and message required");

    // 获取会话
    const session = await this.sessionManager.get(sessionId);
    if (!session) throw new Error("Session not found");

    try {
      // 发送开始事件
      context.send({
        jsonrpc: "2.0",
        method: "agent.message",
        params: { type: "start", sessionId },
      });

      // TODO: 集成 SaClawClient 进行实际调用
      // 这里模拟流式响应
      const mockResponse = `收到消息: ${message}\n\n这是来自 SaClaw Gateway 的响应。`;
      
      for (let i = 0; i < mockResponse.length; i += 20) {
        const chunk = mockResponse.slice(i, i + 20);
        context.send({
          jsonrpc: "2.0",
          method: "agent.message",
          params: { type: "text", content: chunk, sessionId },
        });
        await new Promise((r) => setTimeout(r, 50));
      }

      // 发送完成事件
      context.send({
        jsonrpc: "2.0",
        method: "agent.complete",
        params: { sessionId },
      });

      // 更新会话统计
      await this.sessionManager.updateStats(sessionId, { messageCount: 1, tokenCount: mockResponse.length });
    } catch (error) {
      context.send({
        jsonrpc: "2.0",
        method: "agent.error",
        params: { sessionId, error: error instanceof Error ? error.message : "Unknown error" },
      });
    }
  }

  private async agentAbort(params: Record<string, unknown>, _context: HandlerContext): Promise<{ success: boolean }> {
    const sessionId = params.sessionId as string | undefined;
    if (!sessionId) throw new Error("sessionId required");

    // TODO: 实现中断逻辑
    return { success: true };
  }

  // ============================================
  // 渠道管理
  // ============================================

  private async channelList(): Promise<Channel[]> {
    // TODO: 从 IMAdapterManager 获取渠道列表
    return [];
  }

  private async channelConnect(params: Record<string, unknown>): Promise<Channel> {
    const platform = params.platform as string;
    
    if (!platform) throw new Error("platform required");

    // TODO: 实现渠道连接
    throw new Error("Not implemented");
  }

  private async channelDisconnect(params: Record<string, unknown>): Promise<{ success: boolean }> {
    const channelId = params.channelId as string;
    if (!channelId) throw new Error("channelId required");

    // TODO: 实现渠道断开
    return { success: true };
  }

  // ============================================
  // 工具管理
  // ============================================

  private async toolsList(): Promise<Tool[]> {
    // TODO: 从 CapabilitiesManager 获取工具列表
    return [];
  }

  private async toolsExecute(params: Record<string, unknown>): Promise<unknown> {
    const { name, input: _input } = params;
    if (!name) throw new Error("Tool name required");

    // TODO: 从 CapabilitiesManager 执行工具
    throw new Error("Not implemented");
  }

  // ============================================
  // 内存管理
  // ============================================

  private async memorySearch(params: Record<string, unknown>): Promise<MemoryResult[]> {
    const { query, limit: _limit = 10 } = params as MemorySearchParams;
    if (!query) throw new Error("query required");

    // TODO: 从 MemoryManager 搜索
    return [];
  }

  // ============================================
  // 系统状态
  // ============================================

  private async systemStatus(): Promise<{
    version: string;
    uptime: number;
    sessions: number;
  }> {
    return {
      version: "0.1.0",
      uptime: process.uptime(),
      sessions: this.sessionManager.size(),
    };
  }
}
