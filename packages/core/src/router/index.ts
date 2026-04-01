import EventEmitter from "eventemitter3";
import type { Message, SACODEEvent, Session } from "../types";

export interface RouterOptions {
  defaultHandler?: (message: Message, session: Session) => Promise<void>;
}

export type MessageHandler = (message: Message, session: Session) => Promise<void>;

export class MessageRouter extends EventEmitter<{
  routed: (event: SACODEEvent) => void;
}> {
  private handlers: Map<string, MessageHandler[]> = new Map();
  private defaultHandler: MessageHandler | undefined;

  constructor(options: RouterOptions = {}) {
    super();
    this.defaultHandler = options.defaultHandler;
  }

  register(pattern: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(pattern) || [];
    handlers.push(handler);
    this.handlers.set(pattern, handlers);
  }

  unregister(pattern: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(pattern);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  async route(message: Message, session: Session): Promise<void> {
    const handlers = this.findHandlers(message);

    if (handlers.length === 0 && this.defaultHandler) {
      await this.defaultHandler(message, session);
    } else {
      for (const handler of handlers) {
        await handler(message, session);
      }
    }

    this.emit("routed", {
      type: "message",
      payload: { message, sessionId: session.id },
      timestamp: new Date(),
    });
  }

  private findHandlers(message: Message): MessageHandler[] {
    const handlers: MessageHandler[] = [];

    for (const [pattern, patternHandlers] of this.handlers) {
      if (this.matchPattern(pattern, message)) {
        handlers.push(...patternHandlers);
      }
    }

    return handlers;
  }

  private matchPattern(pattern: string, message: Message): boolean {
    // 简单的模式匹配
    if (pattern === "*") {
      return true;
    }

    if (pattern.startsWith("role:")) {
      const role = pattern.slice(5);
      return message.role === role;
    }

    if (pattern.startsWith("channel:")) {
      const channelId = pattern.slice(8);
      return message.channelId === channelId;
    }

    return false;
  }
}

// 导出智能路由器
export {
  SmartRouter,
  createSmartRouter,
  RuleTemplates,
  type SmartRouterOptions,
  type SmartRouterEvent,
  type RoutingRule,
  type RoutingCondition,
  type RoutingAction,
  type RoutingResult,
  type ConditionOperator,
  type ConditionField,
  type ActionType,
  type RuleStorage,
} from "./smart-router.js";
