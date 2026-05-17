/**
 * QueryEngine - 查询引擎
 *
 * 采用 AsyncGenerator 模式实现流式响应
 * 参考 Claude Code QueryEngine 设计
 */

import type {
  SACODEClient,
  Message as CoreMessage,
  ToolCall,
  ToolDefinition,
} from "@sacode/core";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 查询引擎状态
 */
export type QueryEngineState =
  | "idle"
  | "checking_compaction"
  | "compacting"
  | "streaming"
  | "executing_tools"
  | "error"
  | "done";

/**
 * 流式事件类型
 */
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; toolCall: ToolCall }
  | { type: "tool_result"; toolCallId: string; result: string; success: boolean }
  | { type: "tool_denied"; toolCall: ToolCall }
  | { type: "error"; error: Error }
  | { type: "state_change"; state: QueryEngineState }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; stopReason: string }
  | { type: "clarification_request"; question: string; options: { label: string; value: string; description?: string }[]; toolCallId: string }
  | { type: "confirmation_request"; detail: { title: string; message: string; riskLevel: "low" | "medium" | "high" | "critical"; details?: string[] }; toolCallId: string };

/**
 * 消息类型
 */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

/**
 * 工具注册表接口
 */
export interface ToolRegistry {
  getDefinitions(): ToolDefinition[];
  execute(toolCall: ToolCall): Promise<string>;
}

/**
 * 权限引擎接口
 */
export interface PermissionEngine {
  check(toolCall: ToolCall): Promise<boolean>;
  checkWithDetail(toolCall: ToolCall): Promise<{
    allowed: boolean;
    needsConfirmation: boolean;
    riskLevel: "low" | "medium" | "high" | "critical";
    title: string;
    message: string;
    details: string[];
  }>;
}

/**
 * Hook 引擎接口
 */
export interface HookEngine {
  run(event: string, ...args: unknown[]): Promise<void>;
}

/**
 * 记忆管理器接口
 */
export interface MemoryManager {
  recall(query: string): Promise<string[]>;
  remember(content: string): Promise<void>;
}

/**
 * 查询引擎依赖
 */
export interface QueryDeps {
  client: SACODEClient;
  tools?: ToolRegistry;
  permissions?: PermissionEngine;
  hooks?: HookEngine;
  memory?: MemoryManager;
}

/**
 * 查询选项
 */
export interface QueryOptions {
  /** 系统提示词 */
  systemPrompt?: string;
  /** 最大循环次数 */
  maxLoops?: number;
  /** 温度参数 */
  temperature?: number;
  /** 最大 Token 数 */
  maxTokens?: number;
}

/**
 * Token 使用量
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ============================================================================
// QueryEngine 类
// ============================================================================

/**
 * 查询引擎
 *
 * 使用 AsyncGenerator 实现流式响应，支持：
 * - 流式文本输出
 * - 工具调用执行
 * - 权限检查
 * - 钩子系统
 */
export class QueryEngine {
  private state: QueryEngineState = "idle";
  private messages: Message[] = [];
  private usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private abortController?: AbortController;

  constructor(private deps: QueryDeps) {}

  /**
   * 获取当前状态
   */
  getState(): QueryEngineState {
    return this.state;
  }

  /**
   * 获取消息历史
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * 获取 Token 使用量
   */
  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  /**
   * 中止当前查询
   */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * 核心查询方法 - AsyncGenerator 流式模式
   */
  async *query(
    userInput: string,
    options: QueryOptions = {}
  ): AsyncGenerator<StreamEvent> {
    const { maxLoops = 10 } = options;

    this.abortController = new AbortController();
    let loopCount = 0;

    // 添加用户消息
    if (userInput) {
      this.messages.push({
        role: "user",
        content: userInput,
      });
    }

    while (loopCount < maxLoops) {
      loopCount++;

      // 检查是否已中止
      if (this.abortController.signal.aborted) {
        yield { type: "error", error: new Error("Query aborted") };
        return;
      }

      // 更新状态
      yield* this.setState("streaming");

      try {
        // 流式调用 API
        const stream = this.deps.client.chatWithOptions({
          message: userInput,
        });

        let assistantContent = "";
        const toolCalls: ToolCall[] = [];

        for await (const chunk of stream) {
          const message = chunk as CoreMessage;

          if (message.role === "assistant" && message.chunk?.text) {
            assistantContent += message.chunk.text;
            yield { type: "text_delta", text: message.chunk.text };
          } else if (message.role === "tool") {
            const toolCall = createToolCallFromMessage(message);
            if (toolCall) {
              toolCalls.push(toolCall);
            }
          } else if (message.role === "system" && "stopReason" in message) {
            if (message.stopReason === "end_turn" || message.stopReason === "stop_sequence") {
              if (assistantContent || toolCalls.length === 0) {
                this.messages.push({
                  role: "assistant",
                  content: assistantContent,
                  toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                });
              }

              yield { type: "done", stopReason: message.stopReason };
              yield* this.setState("done");
              return;
            }
          } else if (message.role === "system" && "message" in message) {
            yield { type: "error", error: new Error(message.message) };
            yield* this.setState("error");
            return;
          }
        }

        // 处理工具调用
        if (toolCalls.length > 0) {
          yield* this.setState("executing_tools");
          yield* this.executeTools(toolCalls);

          // 继续循环（等待下一轮响应）
          continue;
        }

        // 没有工具调用，结束
        yield* this.setState("done");
        return;
      } catch (error) {
        yield { type: "error", error: error instanceof Error ? error : new Error(String(error)) };
        yield* this.setState("error");
        return;
      }
    }

    // 达到最大循环次数
    yield { type: "done", stopReason: "max_loops" };
    yield* this.setState("done");
  }

  /**
   * 执行工具调用
   */
  private async *executeTools(toolCalls: ToolCall[]): AsyncGenerator<StreamEvent> {
    if (!this.deps.tools) {
      yield { type: "error", error: new Error("Tool registry not available") };
      return;
    }

    // 添加助手消息（包含工具调用）
    this.messages.push({
      role: "assistant",
      content: "",
      toolCalls,
    });

    for (const toolCall of toolCalls) {
      // 权限检查
      if (this.deps.permissions) {
        const detail = await this.deps.permissions.checkWithDetail(toolCall);
        if (detail.needsConfirmation) {
          yield {
            type: "confirmation_request",
            detail: {
              title: detail.title,
              message: detail.message,
              riskLevel: detail.riskLevel,
              details: detail.details,
            },
            toolCallId: toolCall.id,
          };
          const userDecision = await this.waitForUserResponse(toolCall.id);
          if (userDecision !== "confirmed") {
            yield { type: "tool_denied", toolCall };
            this.messages.push({
              role: "tool",
              content: "Tool execution denied by user",
              toolCallId: toolCall.id,
            });
            continue;
          }
        } else if (!detail.allowed) {
          yield { type: "tool_denied", toolCall };
          this.messages.push({
            role: "tool",
            content: `Tool execution denied: ${detail.message}`,
            toolCallId: toolCall.id,
          });
          continue;
        }
      }

      // 执行前钩子
      await this.deps.hooks?.run("beforeTool", toolCall);

      // 发送工具开始事件
      yield { type: "tool_start", toolCall };

      // 特殊工具：ask_clarification → 发出交互事件
      const toolName = toolCall.function.name;
      if (toolName === "ask_clarification") {
        const args = this.parseToolArgs(toolCall);
        const question = String(args.question ?? "");
        const rawOptions = args.options as string[] | undefined;
        const options = (rawOptions ?? []).map((opt, i) => ({
          label: typeof opt === "string" ? opt : String(opt),
          value: typeof opt === "string" ? opt : String(opt),
          description: undefined as string | undefined,
        }));
        yield {
          type: "clarification_request",
          question,
          options,
          toolCallId: toolCall.id,
        };
        // 暂停等待用户选择 — 由外部 resolve 回调注入结果
        const userAnswer = await this.waitForUserResponse(toolCall.id);
        this.messages.push({
          role: "tool",
          content: userAnswer,
          toolCallId: toolCall.id,
        });
        yield { type: "tool_result", toolCallId: toolCall.id, result: userAnswer, success: true };
        continue;
      }

      try {
        // 执行工具
        const result = await this.deps.tools.execute(toolCall);

        // 执行后钩子
        await this.deps.hooks?.run("afterTool", toolCall, result);

        // 发送结果事件
        yield { type: "tool_result", toolCallId: toolCall.id, result, success: true };

        // 添加工具结果消息
        this.messages.push({
          role: "tool",
          content: result,
          toolCallId: toolCall.id,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // 发送失败结果
        yield {
          type: "tool_result",
          toolCallId: toolCall.id,
          result: errorMessage,
          success: false,
        };

        // 添加错误结果消息
        this.messages.push({
          role: "tool",
          content: `Error: ${errorMessage}`,
          toolCallId: toolCall.id,
        });
      }
    }
  }

  /**
   * 设置状态并发出事件
   */
  private async *setState(state: QueryEngineState): AsyncGenerator<StreamEvent> {
    this.state = state;
    yield { type: "state_change", state };
  }

  // 用户交互响应等待映射
  private pendingUserResponses = new Map<string, { resolve: (value: string) => void }>();

  /**
   * 等待用户响应（用于 clarification/confirmation 交互）
   */
  private waitForUserResponse(toolCallId: string): Promise<string> {
    return new Promise<string>((resolve) => {
      this.pendingUserResponses.set(toolCallId, { resolve });
    });
  }

  /**
   * 解析工具参数
   */
  private parseToolArgs(toolCall: ToolCall): Record<string, unknown> {
    try {
      const args = toolCall.function.arguments;
      return typeof args === "string" ? JSON.parse(args) : args;
    } catch {
      return {};
    }
  }

  /**
   * 外部注入用户响应（由 UI 层调用）
   */
  resolveUserResponse(toolCallId: string, value: string): void {
    const pending = this.pendingUserResponses.get(toolCallId);
    if (pending) {
      pending.resolve(value);
      this.pendingUserResponses.delete(toolCallId);
    }
  }

  /**
   * 清空消息历史
   */
  clearMessages(): void {
    this.messages = [];
    this.usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  /**
   * 重置引擎状态
   */
  reset(): void {
    this.state = "idle";
    this.clearMessages();
    this.abortController?.abort();
    this.abortController = undefined;
  }
}

// ============================================================================
// 导出
// ============================================================================

export default QueryEngine;

function createToolCallFromMessage(message: Extract<CoreMessage, { role: "tool" }>): ToolCall | null {
  if (!message.toolName) {
    return null;
  }

  return {
    id: message.id,
    type: "function",
    function: {
      name: message.toolName,
      arguments: "{}",
    },
  };
}
