/**
 * Agent 通信层
 *
 * 实现 Agent-to-Agent 消息传递机制，支持多 Agent 协作
 * 基于 OMO (Oh My OpenCode) 的多 Agent 编排设计
 */

import EventEmitter from "eventemitter3";
import type { AgentMessage, AgentMessageType } from "./types";

// ============================================
// 类型定义
// ============================================

/**
 * 通信层事件
 */
export interface CommunicationEvents {
  /** 消息发送 */
  message_sent: (message: AgentMessage) => void;
  /** 消息接收 */
  message_received: (message: AgentMessage) => void;
  /** 消息处理完成 */
  message_handled: (message: AgentMessage, result: unknown) => void;
  /** 错误 */
  error: (error: Error, message?: AgentMessage) => void;
}

/**
 * 消息处理器
 */
export type MessageHandler = (
  message: AgentMessage
) => Promise<unknown> | unknown;

/**
 * 消息处理器注册信息
 */
export interface HandlerRegistration {
  /** Agent ID */
  agentId: string;
  /** 处理的消息类型（可选，不指定则处理所有类型） */
  messageTypes?: AgentMessageType[];
  /** 处理器函数 */
  handler: MessageHandler;
  /** 优先级（越高越优先） */
  priority: number;
}

/**
 * 消息路由策略
 */
export type RoutingStrategy =
  | "direct"      // 直接发送给目标
  | "broadcast"   // 广播给所有 Agent
  | "round-robin" // 轮询发送
  | "load-balance"; // 负载均衡

/**
 * 通信层配置
 */
export interface CommunicationConfig {
  /** 消息队列最大长度 */
  maxQueueSize: number;
  /** 消息超时时间（毫秒） */
  messageTimeout: number;
  /** 是否启用消息确认 */
  enableAck: boolean;
  /** 最大重试次数 */
  maxRetries: number;
  /** 路由策略 */
  routingStrategy: RoutingStrategy;
}

/**
 * 消息队列项
 */
interface QueuedMessage {
  message: AgentMessage;
  retries: number;
  timestamp: number;
}

// ============================================
// AgentChannel 实现
// ============================================

/**
 * Agent 通信通道
 *
 * 管理 Agent 间的消息传递
 */
export class AgentChannel extends EventEmitter<CommunicationEvents> {
  private handlers: Map<string, HandlerRegistration[]> = new Map();
  private messageQueue: Map<string, QueuedMessage[]> = new Map();
  private agentStatus: Map<string, "busy" | "idle"> = new Map();
  private config: Required<CommunicationConfig>;
  private messageCounter = 0;

  constructor(config: Partial<CommunicationConfig> = {}) {
    super();
    this.config = {
      maxQueueSize: config.maxQueueSize ?? 100,
      messageTimeout: config.messageTimeout ?? 60000,
      enableAck: config.enableAck ?? true,
      maxRetries: config.maxRetries ?? 3,
      routingStrategy: config.routingStrategy ?? "direct",
    };
  }

  // ============================================
  // Agent 注册
  // ============================================

  /**
   * 注册 Agent
   */
  registerAgent(agentId: string): void {
    if (!this.handlers.has(agentId)) {
      this.handlers.set(agentId, []);
      this.messageQueue.set(agentId, []);
      this.agentStatus.set(agentId, "idle");
    }
  }

  /**
   * 注销 Agent
   */
  unregisterAgent(agentId: string): void {
    this.handlers.delete(agentId);
    this.messageQueue.delete(agentId);
    this.agentStatus.delete(agentId);
  }

  /**
   * 注册消息处理器
   */
  registerHandler(registration: HandlerRegistration): void {
    this.registerAgent(registration.agentId);

    const handlers = this.handlers.get(registration.agentId) ?? [];
    handlers.push(registration);
    
    // 按优先级排序
    handlers.sort((a, b) => b.priority - a.priority);
    
    this.handlers.set(registration.agentId, handlers);
  }

  /**
   * 移除消息处理器
   */
  removeHandler(agentId: string, handler: MessageHandler): boolean {
    const handlers = this.handlers.get(agentId);
    if (!handlers) return false;

    const index = handlers.findIndex((h) => h.handler === handler);
    if (index === -1) return false;

    handlers.splice(index, 1);
    return true;
  }

  // ============================================
  // 消息发送
  // ============================================

  /**
   * 发送消息
   */
  async send(message: Omit<AgentMessage, "id" | "timestamp">): Promise<AgentMessage> {
    const fullMessage: AgentMessage = {
      ...message,
      id: `msg_${Date.now()}_${++this.messageCounter}`,
      timestamp: new Date(),
    };

    // 检查目标是否存在
    if (!this.handlers.has(fullMessage.to)) {
      throw new Error(`Target agent not found: ${fullMessage.to}`);
    }

    // 加入队列
    this.enqueueMessage(fullMessage);

    this.emit("message_sent", fullMessage);

    // 尝试处理消息
    await this.processQueue(fullMessage.to);

    return fullMessage;
  }

  /**
   * 广播消息给所有 Agent
   */
  async broadcast(
    from: string,
    type: AgentMessageType,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<AgentMessage[]> {
    const results: AgentMessage[] = [];

    for (const agentId of this.handlers.keys()) {
      if (agentId !== from) {
        const baseMessage = {
          from,
          to: agentId,
          type,
          content,
        };
        const message = await this.send(
          metadata ? { ...baseMessage, metadata } : baseMessage
        );
        results.push(message);
      }
    }

    return results;
  }

  /**
   * 发送任务消息
   */
  async sendTask(
    from: string,
    to: string,
    task: string,
    planId?: string,
    stepId?: string
  ): Promise<AgentMessage> {
    const baseMessage = {
      from,
      to,
      type: "task" as const,
      content: task,
    };
    const extras: Record<string, string> = {};
    if (planId !== undefined) extras.planId = planId;
    if (stepId !== undefined) extras.stepId = stepId;
    return this.send(Object.keys(extras).length > 0 ? { ...baseMessage, ...extras } : baseMessage);
  }

  /**
   * 发送查询消息
   */
  async sendQuery(
    from: string,
    to: string,
    query: string
  ): Promise<AgentMessage> {
    return this.send({
      from,
      to,
      type: "query",
      content: query,
    });
  }

  /**
   * 发送响应消息
   */
  async sendResponse(
    from: string,
    to: string,
    content: string,
    originalMessage: AgentMessage
  ): Promise<AgentMessage> {
    const baseMessage = {
      from,
      to,
      type: "response" as const,
      content,
      metadata: {
        replyTo: originalMessage.id,
      },
    };
    const extras: Record<string, string> = {};
    if (originalMessage.planId !== undefined) extras.planId = originalMessage.planId;
    if (originalMessage.stepId !== undefined) extras.stepId = originalMessage.stepId;
    return this.send(Object.keys(extras).length > 0 ? { ...baseMessage, ...extras } : baseMessage);
  }

  /**
   * 发送状态更新
   */
  async sendStatus(
    from: string,
    to: string,
    status: string
  ): Promise<AgentMessage> {
    return this.send({
      from,
      to,
      type: "status",
      content: status,
    });
  }

  // ============================================
  // 消息处理
  // ============================================

  /**
   * 处理消息队列
   */
  private async processQueue(agentId: string): Promise<void> {
    const queue = this.messageQueue.get(agentId);
    if (!queue || queue.length === 0) return;

    // 检查 Agent 状态
    if (this.agentStatus.get(agentId) === "busy") {
      return;
    }

    this.agentStatus.set(agentId, "busy");

    try {
      while (queue.length > 0) {
        const item = queue[0];
        if (!item) break;

        // 检查超时
        if (Date.now() - item.timestamp > this.config.messageTimeout) {
          queue.shift();
          continue;
        }

        try {
          await this.handleMessage(item.message);
          queue.shift(); // 成功处理后移除
        } catch (error) {
          item.retries++;
          if (item.retries >= this.config.maxRetries) {
            queue.shift();
            this.emit(
              "error",
              error instanceof Error ? error : new Error(String(error)),
              item.message
            );
          }
        }
      }
    } finally {
      this.agentStatus.set(agentId, "idle");
    }
  }

  /**
   * 处理单个消息
   */
  private async handleMessage(message: AgentMessage): Promise<void> {
    const handlers = this.handlers.get(message.to);
    if (!handlers || handlers.length === 0) {
      throw new Error(`No handlers for agent: ${message.to}`);
    }

    this.emit("message_received", message);

    for (const registration of handlers) {
      // 检查消息类型是否匹配
      if (
        registration.messageTypes &&
        registration.messageTypes.length > 0 &&
        !registration.messageTypes.includes(message.type)
      ) {
        continue;
      }

      try {
        const result = await registration.handler(message);
        this.emit("message_handled", message, result);
        return; // 第一个成功的处理器处理完毕后返回
      } catch (error) {
        // 继续尝试下一个处理器
        console.error(
          `[AgentChannel] Handler error for ${message.to}:`,
          error
        );
      }
    }

    throw new Error(`No handler successfully processed message ${message.id}`);
  }

  /**
   * 加入消息队列
   */
  private enqueueMessage(message: AgentMessage): void {
    const queue = this.messageQueue.get(message.to);
    if (!queue) {
      throw new Error(`No queue for agent: ${message.to}`);
    }

    if (queue.length >= this.config.maxQueueSize) {
      throw new Error(`Message queue full for agent: ${message.to}`);
    }

    queue.push({
      message,
      retries: 0,
      timestamp: Date.now(),
    });
  }

  // ============================================
  // 状态查询
  // ============================================

  /**
   * 获取 Agent 状态
   */
  getAgentStatus(agentId: string): "busy" | "idle" | undefined {
    return this.agentStatus.get(agentId);
  }

  /**
   * 获取队列长度
   */
  getQueueLength(agentId: string): number {
    return this.messageQueue.get(agentId)?.length ?? 0;
  }

  /**
   * 获取所有已注册的 Agent
   */
  getRegisteredAgents(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * 清空队列
   */
  clearQueue(agentId: string): void {
    this.messageQueue.get(agentId)?.splice(0);
  }

  /**
   * 清空所有队列
   */
  clearAllQueues(): void {
    for (const queue of this.messageQueue.values()) {
      queue.splice(0);
    }
  }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 Agent 通信通道
 */
export function createAgentChannel(
  config?: Partial<CommunicationConfig>
): AgentChannel {
  return new AgentChannel(config);
}
