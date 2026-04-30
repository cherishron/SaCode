import type { StreamEvent, AgenticLoopConfig, ConversationMessage } from "./types.js";
import { ContextManager } from "./context.js";
import { ToolExecutor } from "./executor.js";
import type { SACODEClient } from "@sacode/core";

const DEFAULT_MAX_ITERATIONS = 25;
const LOOP_DETECTION_THRESHOLD = 3;

export class AgenticLoop {
  private config: AgenticLoopConfig;
  private contextManager: ContextManager;
  private toolExecutor: ToolExecutor;
  private iterationCount = 0;
  private recentToolCalls: string[] = [];
  private client: SACODEClient | null = null;

  constructor(
    config: AgenticLoopConfig,
    rootDir: string,
    client?: SACODEClient,
  ) {
    this.config = {
      ...config,
      maxIterations: config.maxIterations || DEFAULT_MAX_ITERATIONS,
    };
    this.contextManager = new ContextManager(rootDir, config.contextWindow);
    this.toolExecutor = new ToolExecutor(config.tools, config.autoApprove);
    this.client = client ?? null;
  }

  /**
   * 设置 SACODEClient 实例（支持运行时注入）
   */
  setClient(client: SACODEClient): void {
    this.client = client;
  }

  /**
   * 执行代理循环 — 使用 AsyncGenerator 产出事件流
   */
  async *run(userMessage: string): AsyncGenerator<StreamEvent> {
    this.iterationCount = 0;
    this.recentToolCalls = [];

    const projectContext = await this.contextManager.gatherProjectContext();
    const systemPrompt = this.contextManager.buildSystemPrompt(projectContext);

    this.contextManager.addMessage({ role: "system", content: systemPrompt });
    this.contextManager.addMessage({ role: "user", content: userMessage });

    while (this.iterationCount < this.config.maxIterations) {
      this.iterationCount++;

      if (this.detectLoop()) {
        yield { type: "error", message: "Loop detected: repeated tool calls. Breaking." };
        break;
      }

      const response = await this.callAI();

      if (response.content) {
        yield { type: "content", text: response.content };
      }

      if (response.thinking) {
        yield { type: "thought", text: response.thinking };
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        yield {
          type: "finished",
          usage: response.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
        break;
      }

      for (const toolCall of response.toolCalls) {
        yield {
          type: "tool_call",
          id: toolCall.id,
          name: toolCall.name,
          args: toolCall.args,
        };

        this.recentToolCalls.push(toolCall.name);

        const startTime = Date.now();
        const result = await this.toolExecutor.execute(
          toolCall.id,
          toolCall.name,
          toolCall.args,
        );

        yield {
          type: "tool_result",
          id: toolCall.id,
          name: toolCall.name,
          result: result.output,
          success: result.success,
          duration: Date.now() - startTime,
        };

        this.contextManager.addMessage({
          role: "tool",
          content: result.success ? result.output : `Error: ${result.error}`,
          toolCallId: toolCall.id,
        });
      }

      this.contextManager.compactHistory(20);
    }

    if (this.iterationCount >= this.config.maxIterations) {
      yield { type: "error", message: `Max iterations (${this.config.maxIterations}) reached.` };
    }
  }

  private detectLoop(): boolean {
    if (this.recentToolCalls.length < LOOP_DETECTION_THRESHOLD * 2) return false;

    const recent = this.recentToolCalls.slice(-LOOP_DETECTION_THRESHOLD);
    const previous = this.recentToolCalls.slice(
      -LOOP_DETECTION_THRESHOLD * 2,
      -LOOP_DETECTION_THRESHOLD,
    );

    return JSON.stringify(recent) === JSON.stringify(previous);
  }

  /**
   * 调用 AI Provider
   *
   * 优先使用注入的 SACODEClient 实例进行流式调用，
   * 回退到占位响应（用于测试和离线模式）
   */
  private async callAI(): Promise<{
    content?: string;
    thinking?: string;
    toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }> {
    if (!this.client || !this.client.isConnected()) {
      return {
        content: "[OFFLINE] AI 服务未连接，请使用 /providers 配置后重试",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    try {
      const messages = this.contextManager.getMessages();
      const lastUserMessage = messages
        .filter((m) => m.role === "user")
        .pop();

      const userContent = lastUserMessage?.content ?? "";

      let content = "";
      let thinking: string | undefined;
      const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      const stream = this.client.chat(userContent);

      for await (const chunk of stream) {
        const msg = chunk as {
          role?: string;
          type?: string;
          text?: string;
          chunk?: { text?: string };
          content?: string;
          thinking?: string;
          toolCalls?: Array<{ id: string; name: string; arguments: string }>;
          toolCall?: { id: string; name: string; arguments: string };
          usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
        };

        if (msg.type === "text_delta" && msg.text) {
          content += msg.text;
        } else if (msg.type === "thinking_delta" && msg.thinking) {
          thinking = (thinking ?? "") + msg.thinking;
        } else if (msg.type === "tool_call" && msg.toolCall) {
          try {
            const args = JSON.parse(msg.toolCall.arguments || "{}");
            toolCalls.push({
              id: msg.toolCall.id,
              name: msg.toolCall.name,
              args,
            });
          } catch {
            toolCalls.push({
              id: msg.toolCall.id,
              name: msg.toolCall.name,
              args: {},
            });
          }
        } else if (msg.type === "usage" && msg.usage) {
          usage = msg.usage;
        } else if (msg.role === "assistant" && msg.chunk?.text) {
          content += msg.chunk.text;
        } else if (msg.role === "assistant" && typeof msg.content === "string") {
          content += msg.content;
        } else if (msg.role === "tool" && msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            try {
              const args = JSON.parse(tc.arguments || "{}");
              toolCalls.push({ id: tc.id, name: tc.name, args });
            } catch {
              toolCalls.push({ id: tc.id, name: tc.name, args: {} });
            }
          }
        }
      }

      if (content) {
        this.contextManager.addMessage({
          role: "assistant",
          content,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });
      }

      return {
        content: content || undefined,
        thinking,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage,
      };
    } catch (err) {
      return {
        content: `[ERROR] AI 调用失败: ${err instanceof Error ? err.message : "unknown error"}`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
  }

  getIterationCount(): number {
    return this.iterationCount;
  }
}
