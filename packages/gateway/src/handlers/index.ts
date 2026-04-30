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

/**
 * Gateway 依赖注入接口
 */
export interface GatewayDeps {
  sessionManager: SessionManager;
  sacodeClient?: {
    chat: (message: string, sessionId?: string) => AsyncIterable<unknown>;
    isConnected: () => boolean;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
  };
  imAdapterManager?: {
    getAll: () => Map<string, { getChannels?: () => Promise<Channel[]> }>;
    connect: (platform: string, config: Record<string, unknown>) => Promise<unknown>;
    disconnect: (platform: string) => Promise<void>;
    has: (platform: string) => boolean;
  };
  capabilitiesManager?: {
    getAllTools: () => Tool[];
    executeTool: (name: string, input: unknown) => Promise<unknown>;
  };
  memoryManager?: {
    getSessionMemory: (sessionId: string) => Promise<{ content: string }>;
    updateSessionMemory: (sessionId: string, content: string) => Promise<void>;
    searchMemory: (query: string, limit?: number) => Promise<MemoryResult[]>;
  };
}

export class RPCHandler {
  private handlers: Map<string, RPCHandlerFn> = new Map();
  private deps: GatewayDeps;

  constructor(deps: GatewayDeps) {
    this.deps = deps;
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

    return this.deps.sessionManager.listByUser(userId);
  }

  private async sessionGet(params: Record<string, unknown>): Promise<Session | null> {
    const sessionId = params.sessionId as string | undefined;
    if (!sessionId) throw new Error("sessionId required");

    return this.deps.sessionManager.get(sessionId);
  }

  private async sessionCreate(params: Record<string, unknown>, context: HandlerContext): Promise<Session> {
    const userId = context.userId;
    if (!userId) throw new Error("User not authenticated");

    const session = await this.deps.sessionManager.create({
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

    await this.deps.sessionManager.delete(sessionId);
    context.broadcast("session.deleted", { sessionId });

    return { success: true };
  }

  private async sessionReset(params: Record<string, unknown>): Promise<Session> {
    const sessionId = params.sessionId as string | undefined;
    if (!sessionId) throw new Error("sessionId required");

    return this.deps.sessionManager.reset(sessionId);
  }

  // ============================================
  // Agent 调用
  // ============================================

  private activeStreams = new Map<string, AbortController>();

  private async agentSend(params: Record<string, unknown>, context: HandlerContext): Promise<void> {
    const { sessionId, message } = params as AgentSendParams;
    if (!sessionId || !message) throw new Error("sessionId and message required");

    const session = await this.deps.sessionManager.get(sessionId);
    if (!session) throw new Error("Session not found");

    const abortController = new AbortController();
    this.activeStreams.set(sessionId, abortController);

    try {
      context.send({
        jsonrpc: "2.0",
        method: "agent.message",
        params: { type: "start", sessionId },
      });

      if (this.deps.sacodeClient) {
        let tokenCount = 0;
        const stream = this.deps.sacodeClient.chat(message, sessionId);

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;

          const msg = chunk as { role?: string; chunk?: { text?: string }; content?: string; text?: string };
          if (msg.role === "assistant" && msg.chunk?.text) {
            context.send({
              jsonrpc: "2.0",
              method: "agent.message",
              params: { type: "text", content: msg.chunk.text, sessionId },
            });
            tokenCount += msg.chunk.text.length;
          } else if (msg.role === "tool") {
            context.send({
              jsonrpc: "2.0",
              method: "agent.message",
              params: { type: "tool", content: JSON.stringify(msg), sessionId },
            });
          } else if (typeof msg.content === "string") {
            context.send({
              jsonrpc: "2.0",
              method: "agent.message",
              params: { type: "text", content: msg.content, sessionId },
            });
            tokenCount += msg.content.length;
          }
        }

        await this.deps.sessionManager.updateStats(sessionId, { messageCount: 1, tokenCount });
      } else {
        const fallbackResponse = `[OFFLINE] AI 服务未连接，消息已记录: ${message.slice(0, 50)}...`;
        context.send({
          jsonrpc: "2.0",
          method: "agent.message",
          params: { type: "text", content: fallbackResponse, sessionId },
        });
      }

      context.send({
        jsonrpc: "2.0",
        method: "agent.complete",
        params: { sessionId },
      });
    } catch (error) {
      context.send({
        jsonrpc: "2.0",
        method: "agent.error",
        params: { sessionId, error: error instanceof Error ? error.message : "Unknown error" },
      });
    } finally {
      this.activeStreams.delete(sessionId);
    }
  }

  private async agentAbort(params: Record<string, unknown>, _context: HandlerContext): Promise<{ success: boolean }> {
    const sessionId = params.sessionId as string | undefined;
    if (!sessionId) throw new Error("sessionId required");

    const controller = this.activeStreams.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(sessionId);
      return { success: true };
    }

    return { success: false };
  }

  // ============================================
  // 渠道管理
  // ============================================

  private async channelList(): Promise<Channel[]> {
    if (!this.deps.imAdapterManager) return [];

    const channels: Channel[] = [];
    const adapters = this.deps.imAdapterManager.getAll();

    for (const [_platform, adapter] of adapters) {
      if (adapter.getChannels) {
        try {
          const platformChannels = await adapter.getChannels();
          channels.push(...platformChannels);
        } catch {
          // 单平台获取失败不影响其他平台
        }
      }
    }

    return channels;
  }

  private async channelConnect(params: Record<string, unknown>): Promise<Channel> {
    const platform = params.platform as string;
    const config = params.config as Record<string, unknown> | undefined;

    if (!platform) throw new Error("platform required");
    if (!this.deps.imAdapterManager) throw new Error("IM adapter manager not available");

    if (this.deps.imAdapterManager.has(platform)) {
      throw new Error(`Platform ${platform} already connected`);
    }

    await this.deps.imAdapterManager.connect(platform, config ?? {});
    return { id: platform, platform: platform as import("./../protocol/index.js").Platform, name: platform, status: "connected" as const };
  }

  private async channelDisconnect(params: Record<string, unknown>): Promise<{ success: boolean }> {
    const channelId = params.channelId as string;
    if (!channelId) throw new Error("channelId required");

    if (this.deps.imAdapterManager) {
      await this.deps.imAdapterManager.disconnect(channelId);
    }

    return { success: true };
  }

  // ============================================
  // 工具管理
  // ============================================

  private async toolsList(): Promise<Tool[]> {
    if (!this.deps.capabilitiesManager) return [];
    return this.deps.capabilitiesManager.getAllTools();
  }

  private async toolsExecute(params: Record<string, unknown>): Promise<unknown> {
    const { name, input } = params;
    if (!name) throw new Error("Tool name required");

    if (!this.deps.capabilitiesManager) throw new Error("Capabilities manager not available");

    return this.deps.capabilitiesManager.executeTool(name as string, input);
  }

  // ============================================
  // 内存管理
  // ============================================

  private async memorySearch(params: Record<string, unknown>): Promise<MemoryResult[]> {
    const { query, limit = 10 } = params as MemorySearchParams;
    if (!query) throw new Error("query required");

    if (!this.deps.memoryManager) return [];

    return this.deps.memoryManager.searchMemory(query, limit as number);
  }

  // ============================================
  // 系统状态
  // ============================================

  private async systemStatus(): Promise<{
    version: string;
    uptime: number;
    sessions: number;
    aiConnected: boolean;
    imPlatforms: number;
    toolsAvailable: number;
  }> {
    return {
      version: "0.1.0",
      uptime: process.uptime(),
      sessions: this.deps.sessionManager.size(),
      aiConnected: this.deps.sacodeClient?.isConnected() ?? false,
      imPlatforms: this.deps.imAdapterManager?.getAll().size ?? 0,
      toolsAvailable: this.deps.capabilitiesManager?.getAllTools().length ?? 0,
    };
  }
}
