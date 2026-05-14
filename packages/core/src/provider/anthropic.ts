/**
 * Anthropic Provider 实现
 *
 * 支持 Claude 系列模型的 API 调用
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  Tool as AnthropicTool,
} from "@anthropic-ai/sdk/resources/messages";
import { BaseProvider } from "./base";
import type {
  AnthropicProviderConfig,
  ChatCompletionOptions,
  StreamChunk,
  ProviderType,
} from "./types";
import {
  APIKeyError,
  ModelNotAvailableError,
  ProviderError,
  RateLimitError,
} from "./types";

// ============================================================================
// Anthropic Provider
// ============================================================================

/**
 * Anthropic Provider 实现
 *
 * 特性：
 * - 流式输出（AsyncGenerator）
 * - Tool Use（工具调用）
 * - 自动重试
 * - 多模型支持（Claude 3.5 Sonnet, Claude 3 Opus 等）
 */
export class AnthropicProvider extends BaseProvider {
  readonly type: ProviderType = "anthropic";
  private client: Anthropic | null = null;

  constructor(config: AnthropicProviderConfig) {
    super(config);
  }

  /**
   * 初始化 Anthropic 客户端
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) {
      return;
    }

    // 验证 API Key
    if (!this.config.apiKey) {
      throw new APIKeyError(this.type);
    }

    // 创建 Anthropic 客户端
    const clientOptions: {
      apiKey: string;
      timeout?: number;
      maxRetries?: number;
      baseURL?: string;
    } = {
      apiKey: this.config.apiKey,
      timeout: this.config.timeout ?? 60000,
      maxRetries: 0, // 我们自己处理重试
    };

    // 自定义 baseUrl
    if (this.config.baseUrl) {
      clientOptions.baseURL = this.config.baseUrl;
    }

    this.client = new Anthropic(clientOptions);
    this._isInitialized = true;

    this.emit("initialized");

    if (this.config.debug) {
      console.log(`[${this.type}] Initialized with model: ${this.model}`);
    }
  }

  /**
   * 流式聊天完成
   */
  async *chat(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    if (!this.client || !this._isInitialized) {
      await this.initialize();
    }

    if (!this.client) {
      throw new ProviderError(this.type, "NOT_INITIALIZED", "Provider not initialized");
    }

    // 构建消息
    const messages: MessageParam[] = this.buildMessages(options);

    // 构建工具定义
    const tools: AnthropicTool[] | undefined = options.tools?.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters as AnthropicTool.InputSchema,
    }));

    // 发起流式请求（使用外层 try-catch 处理流迭代错误）
    let streamRetryCount = 0;
    const maxStreamRetries = 1; // 流迭代只允许 1 次重试（避免重复发送内容）

    while (streamRetryCount <= maxStreamRetries) {
      try {
        // 发起流式请求
        const stream = await this.withRetry(
          async () => {
            const params: Anthropic.Messages.MessageCreateParams = {
              model: this.model,
              messages,
              max_tokens: options.maxTokens ?? 4096,
            };

            if (options.systemPrompt) {
              params.system = options.systemPrompt;
            }
            if (tools && tools.length > 0) {
              params.tools = tools;
            }
            if (options.temperature !== undefined) {
              params.temperature = options.temperature;
            }
            if (options.topP !== undefined) {
              params.top_p = options.topP;
            }
            if (options.stopSequences && options.stopSequences.length > 0) {
              params.stop_sequences = options.stopSequences;
            }

            return this.client!.messages.stream(params);
          },
          "messages.stream"
        );

        // Tool Use 累积器：存储正在累积的工具调用参数
        // Anthropic API 的 tool_use 参数通过多个 content_block_delta 事件逐步发送
        // 必须累积完整的 JSON 后才能 yield tool_call
        const toolUseAccumulator = new Map<
          number,
          { id: string; name: string; inputJson: string }
        >();

        // 处理流式响应
        for await (const event of stream) {
          switch (event.type) {
            case "content_block_delta": {
              const delta = event.delta;
              if (delta.type === "text_delta" && delta.text) {
                yield {
                  type: "text_delta",
                  text: delta.text,
                };
              } else if (delta.type === "input_json_delta") {
                // 累积 tool_use 的 JSON 参数
                const index = event.index;
                const accumulator = toolUseAccumulator.get(index);
                if (accumulator && delta.partial_json !== undefined) {
                  accumulator.inputJson += delta.partial_json;
                }
              }
              break;
            }

            case "content_block_start": {
              const block = event.content_block;
              if (block.type === "tool_use") {
                // 初始化累积器，此时 block.input 通常为空对象 {}
                // 真实参数通过后续 content_block_delta 的 input_json_delta 发送
                toolUseAccumulator.set(event.index, {
                  id: block.id,
                  name: block.name,
                  inputJson: "",
                });
              }
              break;
            }

            case "content_block_stop": {
              // content_block_stop 时，该块的所有数据已接收完毕
              const index = event.index;
              const accumulator = toolUseAccumulator.get(index);
              if (accumulator) {
                // yield 完整的 tool_call
                yield {
                  type: "tool_call",
                  toolCall: {
                    id: accumulator.id,
                    type: "function",
                    function: {
                      name: accumulator.name,
                      arguments: accumulator.inputJson || "{}",
                    },
                  },
                };
                // 清理累积器
                toolUseAccumulator.delete(index);
              }
              break;
            }

            case "message_stop": {
              // 获取最终消息
              const finalMessage = await stream.finalMessage();
              const stopReason = this.mapStopReason(finalMessage.stop_reason);

              yield {
                type: "done",
                stopReason,
              };

              this.emitComplete(stopReason);
              return; // 成功完成，退出函数
            }

            default:
              // 忽略其他事件类型
              break;
          }
        }

        // 流正常结束但未收到 message_stop
        return;
      } catch (error) {
        const mappedError = this.mapError(error);

        // 检查是否为可重试的网络错误
        if (
          streamRetryCount < maxStreamRetries &&
          this.isRetryableError(mappedError)
        ) {
          streamRetryCount++;
          if (this.config.debug) {
            console.warn(
              `[${this.type}] Stream iteration error, retrying (${streamRetryCount}/${maxStreamRetries}):`,
              mappedError.message
            );
          }
          await this.sleep(1000 * streamRetryCount);
          continue;
        }

        // 不可重试或重试次数用尽
        this.emitError(mappedError);

        yield {
          type: "error",
          error: {
            code: mappedError instanceof ProviderError ? mappedError.code : "UNKNOWN_ERROR",
            message: mappedError.message,
          },
        };
        return;
      }
    }
  }

  /**
   * 销毁客户端
   */
  override async destroy(): Promise<void> {
    this.client = null;
    await super.destroy();
  }

  /**
   * 构建消息数组
   */
  private buildMessages(options: ChatCompletionOptions): MessageParam[] {
    const messages: MessageParam[] = [];

    for (const msg of options.messages) {
      // 跳过系统消息（Anthropic 使用单独的 system 参数）
      if (msg.role === "system") {
        continue;
      }

      if (msg.role === "tool") {
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.tool_call_id ?? "",
              content: typeof msg.content === "string" ? msg.content : "",
            },
          ],
        });
        continue;
      }

      if (msg.content === null || msg.content === undefined) {
        // 空内容，跳过
        continue;
      }

      if (typeof msg.content === "string") {
        if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
          const content: ContentBlockParam[] = [];
          if (msg.content) {
            content.push({ type: "text", text: msg.content });
          }
          for (const toolCall of msg.tool_calls) {
            content.push({
              type: "tool_use",
              id: toolCall.id,
              name: toolCall.function.name,
              input: this.parseToolInput(toolCall.function.arguments),
            });
          }
          messages.push({
            role: "assistant",
            content,
          });
          continue;
        }

        messages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      } else if (Array.isArray(msg.content)) {
        // 多模态内容
        const content: Anthropic.Messages.ContentBlockParam[] = msg.content.map((c) => {
          if (c.type === "text") {
            return { type: "text" as const, text: c.text ?? "" };
          }
          if (c.type === "image") {
            return {
              type: "image" as const,
              source: {
                type: "url" as const,
                url: c.text ?? "",
              },
            };
          }
          return { type: "text" as const, text: c.text ?? "" };
        });

        messages.push({
          role: msg.role as "user" | "assistant",
          content,
        });
      }
    }

    return messages;
  }

  private parseToolInput(input: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(input);
      return typeof parsed === "object" && parsed !== null
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  /**
   * 映射停止原因
   */
  private mapStopReason(
    reason: string | null | undefined
  ): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "error" {
    switch (reason) {
      case "end_turn":
        return "end_turn";
      case "max_tokens":
        return "max_tokens";
      case "stop_sequence":
        return "stop_sequence";
      case "tool_use":
        return "tool_use";
      default:
        return "end_turn";
    }
  }

  /**
   * 映射错误类型
   */
  private mapError(error: unknown): Error {
    if (error instanceof Error) {
      // Anthropic API 错误
      if (error instanceof Anthropic.APIError) {
        const status = error.status;

        if (status === 401) {
          return new APIKeyError(this.type, "Invalid API key");
        }
        if (status === 429) {
          return new RateLimitError(this.type);
        }
        if (status === 404) {
          return new ModelNotAvailableError(this.type, this.model);
        }

        return new ProviderError(
          this.type,
          "API_ERROR",
          error.message,
          error
        );
      }

      // 其他错误
      return new ProviderError(
        this.type,
        (error as Error & { code?: string }).code ?? "API_ERROR",
        error.message,
        error
      );
    }

    return new ProviderError(this.type, "UNKNOWN_ERROR", String(error));
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Anthropic Provider
 */
export function createAnthropicProvider(config: AnthropicProviderConfig): AnthropicProvider {
  return new AnthropicProvider(config);
}
