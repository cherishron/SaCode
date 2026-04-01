/**
 * Smart Router - 智能路由系统
 *
 * 基于规则的消息路由，支持条件匹配、优先级和多种动作
 */

import EventEmitter from "eventemitter3";
import type { Message, Session } from "../types";

/**
 * 路由条件类型
 */
export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "matches" // 正则匹配
  | "greater_than"
  | "less_than"
  | "in"
  | "not_in"
  | "exists"
  | "not_exists";

/**
 * 条件字段
 */
export type ConditionField =
  | "content"
  | "role"
  | "channelId"
  | "userId"
  | "sessionId"
  | "model"
  | "metadata.*"
  | `metadata.${string}`;

/**
 * 路由条件
 */
export interface RoutingCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value?: string | number | string[] | boolean;
  caseSensitive?: boolean;
}

/**
 * 动作类型
 */
export type ActionType =
  | "forward" // 转发到另一个渠道
  | "model" // 切换模型
  | "skill" // 调用技能
  | "plugin" // 调用插件
  | "transform" // 转换消息内容
  | "webhook" // 调用 webhook
  | "reply" // 直接回复
  | "delegate" // 委托给另一个 agent
  | "queue" // 加入队列
  | "reject"; // 拒绝消息

/**
 * 路由动作
 */
export interface RoutingAction {
  type: ActionType;
  config: Record<string, unknown>;
}

/**
 * 路由规则
 */
export interface RoutingRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number; // 数值越大优先级越高
  conditions: RoutingCondition[];
  conditionLogic: "and" | "or"; // 条件组合逻辑
  actions: RoutingAction[];
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * 路由结果
 */
export interface RoutingResult {
  matched: boolean;
  rule?: RoutingRule;
  actions: RoutingAction[];
  transformedMessage?: Message;
}

/**
 * 路由事件
 */
export interface SmartRouterEvent {
  type: "matched" | "executed" | "error";
  rule?: RoutingRule;
  message: Message;
  result?: RoutingResult;
  error?: Error;
  timestamp: Date;
}

/**
 * 智能路由器选项
 */
export interface SmartRouterOptions {
  rules?: RoutingRule[];
  defaultActions?: RoutingAction[];
  onAction?: (action: RoutingAction, message: Message, session: Session) => Promise<Message | undefined>;
  maxRuleExecutions?: number; // 单次路由最大执行规则数
}

/**
 * 规则存储接口
 */
export interface RuleStorage {
  load(): Promise<RoutingRule[]>;
  save(rules: RoutingRule[]): Promise<void>;
  add(rule: RoutingRule): Promise<void>;
  update(rule: RoutingRule): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * 智能路由器
 */
export class SmartRouter extends EventEmitter<{ event: (e: SmartRouterEvent) => void }> {
  private rules: RoutingRule[] = [];
  private defaultActions: RoutingAction[];
  private onAction: ((action: RoutingAction, message: Message, session: Session) => Promise<Message | undefined>) | undefined;
  private maxRuleExecutions: number;
  private storage?: RuleStorage;

  constructor(options: SmartRouterOptions = {}) {
    super();
    this.rules = options.rules ?? [];
    this.defaultActions = options.defaultActions ?? [];
    if (options.onAction !== undefined) {
      this.onAction = options.onAction;
    } else {
      this.onAction = undefined;
    }
    this.maxRuleExecutions = options.maxRuleExecutions ?? 10;
  }

  /**
   * 设置规则存储
   */
  setStorage(storage: RuleStorage): void {
    this.storage = storage;
  }

  /**
   * 从存储加载规则
   */
  async loadRules(): Promise<void> {
    if (this.storage) {
      this.rules = await this.storage.load();
      this.sortRules();
    }
  }

  /**
   * 保存规则到存储
   */
  async saveRules(): Promise<void> {
    if (this.storage) {
      await this.storage.save(this.rules);
    }
  }

  /**
   * 添加规则
   */
  async addRule(rule: RoutingRule): Promise<void> {
    this.rules.push(rule);
    this.sortRules();
    await this.saveRules();
  }

  /**
   * 更新规则
   */
  async updateRule(rule: RoutingRule): Promise<void> {
    const index = this.rules.findIndex((r) => r.id === rule.id);
    if (index >= 0) {
      this.rules[index] = rule;
      this.sortRules();
      await this.saveRules();
    }
  }

  /**
   * 删除规则
   */
  async deleteRule(id: string): Promise<void> {
    this.rules = this.rules.filter((r) => r.id !== id);
    await this.saveRules();
  }

  /**
   * 获取所有规则
   */
  getRules(): RoutingRule[] {
    return [...this.rules];
  }

  /**
   * 获取单个规则
   */
  getRule(id: string): RoutingRule | undefined {
    return this.rules.find((r) => r.id === id);
  }

  /**
   * 路由消息
   */
  async route(message: Message, session: Session): Promise<RoutingResult[]> {
    const results: RoutingResult[] = [];
    let currentMessage = message;
    let executionCount = 0;

    for (const rule of this.rules) {
      if (executionCount >= this.maxRuleExecutions) {
        break;
      }

      if (!rule.enabled) {
        continue;
      }

      const matched = this.evaluateConditions(rule, currentMessage, session);

      if (matched) {
        executionCount++;

        const result: RoutingResult = {
          matched: true,
          rule,
          actions: rule.actions,
        };

        // 执行动作
        for (const action of rule.actions) {
          try {
            const transformedMessage = await this.executeAction(
              action,
              currentMessage,
              session
            );
            if (transformedMessage) {
              currentMessage = transformedMessage;
              result.transformedMessage = currentMessage;
            }

            this.emit("event", {
              type: "executed",
              rule,
              message: currentMessage,
              result,
              timestamp: new Date(),
            });
          } catch (error) {
            this.emit("event", {
              type: "error",
              rule,
              message: currentMessage,
              result,
              error: error instanceof Error ? error : new Error(String(error)),
              timestamp: new Date(),
            });
          }
        }

        results.push(result);

        this.emit("event", {
          type: "matched",
          rule,
          message: currentMessage,
          result,
          timestamp: new Date(),
        });
      }
    }

    // 如果没有匹配任何规则，执行默认动作
    if (results.length === 0 && this.defaultActions.length > 0) {
      for (const action of this.defaultActions) {
        await this.executeAction(action, currentMessage, session);
      }
    }

    return results;
  }

  /**
   * 评估条件
   */
  private evaluateConditions(
    rule: RoutingRule,
    message: Message,
    session: Session
  ): boolean {
    if (rule.conditions.length === 0) {
      return true;
    }

    const results = rule.conditions.map((condition) =>
      this.evaluateCondition(condition, message, session)
    );

    return rule.conditionLogic === "or"
      ? results.some(Boolean)
      : results.every(Boolean);
  }

  /**
   * 评估单个条件
   */
  private evaluateCondition(
    condition: RoutingCondition,
    message: Message,
    session: Session
  ): boolean {
    const value = this.getFieldValue(condition.field, message, session);

    const opts: { caseSensitive?: boolean } = {};
    if (condition.caseSensitive !== undefined) {
      opts.caseSensitive = condition.caseSensitive;
    }
    return this.applyOperator(value, condition.operator, condition.value, opts);
  }

  /**
   * 获取字段值
   */
  private getFieldValue(
    field: ConditionField,
    message: Message,
    session: Session
  ): unknown {
    if (field === "content") {
      // 只有 UserMessage 有 content
      if ("content" in message) {
        return message.content;
      }
      return undefined;
    }
    if (field === "role") return message.role;
    if (field === "channelId") return message.channelId;
    if (field === "userId") {
      // 从 session 或 metadata 中获取
      return session.metadata?.userId;
    }
    if (field === "sessionId") return session.id;
    if (field === "model") {
      // Session 没有 model 属性，从 metadata 获取
      return session.metadata?.model;
    }
    if (field === "metadata.*") return session.metadata;

    // 支持嵌套 metadata 字段 (metadata.xxx)
    if (field.startsWith("metadata.")) {
      const key = field.slice(9);
      return session.metadata?.[key];
    }

    return undefined;
  }

  /**
   * 应用操作符
   */
  private applyOperator(
    fieldValue: unknown,
    operator: ConditionOperator,
    targetValue: unknown,
    options: { caseSensitive?: boolean } = {}
  ): boolean {
    const { caseSensitive = false } = options;

    switch (operator) {
      case "equals":
        return this.compareEquals(fieldValue, targetValue, caseSensitive);

      case "not_equals":
        return !this.compareEquals(fieldValue, targetValue, caseSensitive);

      case "contains":
        return this.compareContains(fieldValue, targetValue, caseSensitive);

      case "not_contains":
        return !this.compareContains(fieldValue, targetValue, caseSensitive);

      case "starts_with":
        return this.compareStartsWith(fieldValue, targetValue, caseSensitive);

      case "ends_with":
        return this.compareEndsWith(fieldValue, targetValue, caseSensitive);

      case "matches":
        return this.compareMatches(fieldValue, targetValue, caseSensitive);

      case "greater_than":
        return this.compareGreaterThan(fieldValue, targetValue);

      case "less_than":
        return this.compareLessThan(fieldValue, targetValue);

      case "in":
        return this.compareIn(fieldValue, targetValue);

      case "not_in":
        return !this.compareIn(fieldValue, targetValue);

      case "exists":
        return fieldValue !== undefined && fieldValue !== null;

      case "not_exists":
        return fieldValue === undefined || fieldValue === null;

      default:
        return false;
    }
  }

  private compareEquals(a: unknown, b: unknown, caseSensitive: boolean): boolean {
    if (typeof a === "string" && typeof b === "string") {
      return caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
    }
    return a === b;
  }

  private compareContains(a: unknown, b: unknown, caseSensitive: boolean): boolean {
    if (typeof a === "string" && typeof b === "string") {
      return caseSensitive
        ? a.includes(b)
        : a.toLowerCase().includes(b.toLowerCase());
    }
    return false;
  }

  private compareStartsWith(a: unknown, b: unknown, caseSensitive: boolean): boolean {
    if (typeof a === "string" && typeof b === "string") {
      return caseSensitive
        ? a.startsWith(b)
        : a.toLowerCase().startsWith(b.toLowerCase());
    }
    return false;
  }

  private compareEndsWith(a: unknown, b: unknown, caseSensitive: boolean): boolean {
    if (typeof a === "string" && typeof b === "string") {
      return caseSensitive
        ? a.endsWith(b)
        : a.toLowerCase().endsWith(b.toLowerCase());
    }
    return false;
  }

  private compareMatches(a: unknown, b: unknown, caseSensitive: boolean): boolean {
    if (typeof a === "string" && typeof b === "string") {
      try {
        const flags = caseSensitive ? "" : "i";
        const regex = new RegExp(b, flags);
        return regex.test(a);
      } catch {
        return false;
      }
    }
    return false;
  }

  private compareGreaterThan(a: unknown, b: unknown): boolean {
    if (typeof a === "number" && typeof b === "number") {
      return a > b;
    }
    return false;
  }

  private compareLessThan(a: unknown, b: unknown): boolean {
    if (typeof a === "number" && typeof b === "number") {
      return a < b;
    }
    return false;
  }

  private compareIn(a: unknown, b: unknown): boolean {
    if (Array.isArray(b)) {
      return b.includes(a as string);
    }
    return false;
  }

  /**
   * 执行动作
   */
  private async executeAction(
    action: RoutingAction,
    message: Message,
    session: Session
  ): Promise<Message | undefined> {
    if (this.onAction) {
      return await this.onAction(action, message, session);
    }

    // 默认动作处理
    switch (action.type) {
      case "transform": {
        const { content } = action.config;
        if (typeof content === "string" && message.role === "user") {
          // 只有 UserMessage 可以设置 content
          return { ...message, content: content } as Message;
        }
        break;
      }

      case "reply": {
        // 回复动作需要外部处理
        break;
      }

      default:
        // 其他动作类型需要外部处理器
        break;
    }

    return undefined;
  }

  /**
   * 排序规则（按优先级降序）
   */
  private sortRules(): void {
    this.rules.sort((a, b) => b.priority - a.priority);
  }
}

/**
 * 创建智能路由器
 */
export function createSmartRouter(options?: SmartRouterOptions): SmartRouter {
  return new SmartRouter(options);
}

/**
 * 内置规则模板
 */
export const RuleTemplates = {
  /**
   * 代码相关消息路由到代码专家
   */
  codeExpert: (): RoutingRule => ({
    id: "code-expert",
    name: "代码专家路由",
    description: "将代码相关问题路由到代码专家模型",
    enabled: true,
    priority: 100,
    conditions: [
      {
        field: "content",
        operator: "matches",
        value: "(code|代码|函数|function|class|类|bug|error|错误)",
      },
    ],
    conditionLogic: "or",
    actions: [
      {
        type: "model",
        config: { model: "code-expert" },
      },
    ],
  }),

  /**
   * 敏感词过滤
   */
  sensitiveContent: (words: string[]): RoutingRule => ({
    id: "sensitive-content",
    name: "敏感内容过滤",
    description: "检测并拒绝包含敏感内容的消息",
    enabled: true,
    priority: 1000,
    conditions: [
      {
        field: "content",
        operator: "in",
        value: words,
      },
    ],
    conditionLogic: "or",
    actions: [
      {
        type: "reject",
        config: { reason: "内容包含敏感词" },
      },
    ],
  }),

  /**
   * VIP 用户优先处理
   */
  vipPriority: (vipUsers: string[]): RoutingRule => ({
    id: "vip-priority",
    name: "VIP用户优先",
    description: "VIP用户消息优先处理",
    enabled: true,
    priority: 500,
    conditions: [
      {
        field: "userId",
        operator: "in",
        value: vipUsers,
      },
    ],
    conditionLogic: "or",
    actions: [
      {
        type: "model",
        config: { model: "premium", priority: "high" },
      },
    ],
  }),

  /**
   * 工作时间路由
   */
  workingHours: (startHour: number, endHour: number): RoutingRule => {
    const now = new Date();
    const currentHour = now.getHours();
    const isWorkingHours = currentHour >= startHour && currentHour < endHour;

    return {
      id: "working-hours",
      name: "工作时间路由",
      description: "工作时间使用高性能模型，非工作时间使用基础模型",
      enabled: true,
      priority: 50,
      conditions: [
        {
          field: "metadata.isWorkingHours",
          operator: "equals",
          value: isWorkingHours,
        },
      ],
      conditionLogic: "and",
      actions: [
        {
          type: "model",
          config: { model: isWorkingHours ? "premium" : "basic" },
        },
      ],
    };
  },
};
