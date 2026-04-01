/**
 * OpenAI Provider 实现
 *
 * 支持 OpenAI API 以及兼容的国产模型（DeepSeek、Moonshot、智谱）
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { BaseProvider } from "./base";
import type {
  ChatCompletionOptions,
  OpenAIProviderConfig,
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
// OpenAI Provider
// ============================================================================

/**
 * OpenAI Provider 实现
 *
 * 特性：
 * - 流式输出（AsyncGenerator）
 * - Function Calling（工具调用）
 * - 自动重试
 * - 多模型支持
 */
export class OpenAIProvider extends BaseProvider {
  readonly type: ProviderType;
  private client: OpenAI | null = null;

  constructor(config: OpenAIProviderConfig) {
    super(config);
    this.type = config.type;
  }

  /**
   * 初始化 OpenAI 客户端
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) {
      return;
    }

    // 验证 API Key
    if (!this.config.apiKey) {
      throw new APIKeyError(this.type);
    }

    // 创建 OpenAI 客户端
    const clientOptions: {
      apiKey: string;
      timeout?: number;
      maxRetries?: number;
      baseURL?: string;
      organization?: string;
      project?: string;
    } = {
      apiKey: this.config.apiKey,
      timeout: this.config.timeout ?? 60000,
      maxRetries: 0, // 我们自己处理重试
    };

    // 自定义 baseUrl（支持代理和国产模型）
    if (this.config.baseUrl) {
      clientOptions.baseURL = this.config.baseUrl;
    } else {
      // 根据类型设置默认 baseUrl
      clientOptions.baseURL = this.getDefaultBaseUrl();
    }

    // OpenAI 特定配置
    const openaiConfig = this.config as OpenAIProviderConfig;
    if (openaiConfig.organization) {
      clientOptions.organization = openaiConfig.organization;
    }
    if (openaiConfig.project) {
      clientOptions.project = openaiConfig.project;
    }

    this.client = new OpenAI(clientOptions);
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
    const messages: ChatCompletionMessageParam[] = this.buildMessages(options);

    // 构建工具定义
    const tools: Array<{
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }> | undefined = options.tools?.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    }));

    // 发起流式请求（使用外层 try-catch 处理流迭代错误）
    let streamRetryCount = 0;
    const maxStreamRetries = 1; // 流迭代只允许 1 次重试（避免重复发送内容）

    while (streamRetryCount <= maxStreamRetries) {
      try {
        // 发起流式请求
        const stream = await this.withRetry(
          async () => {
            const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
              model: this.model,
              messages,
              stream: true,
            };

            if (tools && tools.length > 0) {
              params.tools = tools;
            }
            if (options.temperature !== undefined) {
              params.temperature = options.temperature;
            }
            if (options.maxTokens !== undefined) {
              params.max_tokens = options.maxTokens;
            }
            if (options.topP !== undefined) {
              params.top_p = options.topP;
            }
            if (options.stopSequences && options.stopSequences.length > 0) {
              params.stop = options.stopSequences;
            }

            return this.client!.chat.completions.create(params);
          },
          "chat.completions.create"
        );

        // 处理流式响应
        let currentToolCall: {
          id: string;
          name: string;
          arguments: string;
        } | null = null;

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          const finishReason = chunk.choices[0]?.finish_reason;

          // 处理文本内容
          if (delta?.content) {
            yield {
              type: "text_delta",
              text: delta.content,
            };
          }

          // 处理工具调用
          if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              // 新的工具调用开始
              if (toolCallDelta.id) {
                // 先完成之前的工具调用
                if (currentToolCall) {
                  yield {
                    type: "tool_call",
                    toolCall: {
                      id: currentToolCall.id,
                      type: "function",
                      function: {
                        name: currentToolCall.name,
                        arguments: currentToolCall.arguments,
                      },
                    },
                  };
                }

                currentToolCall = {
                  id: toolCallDelta.id,
                  name: toolCallDelta.function?.name ?? "",
                  arguments: toolCallDelta.function?.arguments ?? "",
                };
              } else if (currentToolCall && toolCallDelta.function?.arguments) {
                // 追加参数
                currentToolCall.arguments += toolCallDelta.function.arguments;
              }
            }
          }

          // 处理完成
          if (finishReason) {
            // 完成最后的工具调用
            if (currentToolCall) {
              yield {
                type: "tool_call",
                toolCall: {
                  id: currentToolCall.id,
                  type: "function",
                  function: {
                    name: currentToolCall.name,
                    arguments: currentToolCall.arguments,
                  },
                },
              };
              currentToolCall = null;
            }

            const stopReason = this.mapFinishReason(finishReason);
            yield {
              type: "done",
              stopReason,
            };

            this.emitComplete(stopReason);
            return; // 成功完成，退出函数
          }
        }

        // 流正常结束但未收到 finish_reason
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
  private buildMessages(options: ChatCompletionOptions): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];

    // 系统消息
    if (options.systemPrompt) {
      messages.push({
        role: "system",
        content: options.systemPrompt,
      });
    }

    // 用户和助手消息
    for (const msg of options.messages) {
      if (msg.role === "user") {
        if (typeof msg.content === "string") {
          messages.push({
            role: "user",
            content: msg.content,
          });
        } else {
          // 多模态内容
          const content = msg.content.map((c) => {
            if (c.type === "text") {
              return { type: "text" as const, text: c.text };
            }
            if (c.type === "image") {
              return {
                type: "image_url" as const,
                image_url: { url: c.text },
              };
            }
            return { type: "text" as const, text: c.text };
          });
          messages.push({
            role: "user",
            content,
          });
        }
      } else if (msg.role === "assistant") {
        // assistant 只支持文本内容
        const textContent = typeof msg.content === "string" ? msg.content : msg.content.map(c => c.text).join("");
        messages.push({
          role: "assistant",
          content: textContent,
        });
      }
    }

    return messages;
  }

  /**
   * 根据类型获取默认 baseUrl
   */
  private getDefaultBaseUrl(): string {
    switch (this.type) {
      case "deepseek":
        return "https://api.deepseek.com/v1";
      case "moonshot":
        return "https://api.moonshot.cn/v1";
      case "zhipu":
        return "https://open.bigmodel.cn/api/paas/v4";
      case "openai":
      default:
        return "https://api.openai.com/v1";
    }
  }

  /**
   * 映射完成原因
   */
  private mapFinishReason(
    reason: string | null | undefined
  ): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "error" {
    switch (reason) {
      case "stop":
        return "end_turn";
      case "length":
        return "max_tokens";
      case "tool_calls":
        return "tool_use";
      case "content_filter":
        return "error";
      default:
        return "end_turn";
    }
  }

  /**
   * 映射错误类型
   */
  private mapError(error: unknown): Error {
    if (error instanceof Error) {
      // OpenAI API 错误
      if ("status" in error) {
        const apiError = error as Error & { status?: number };
        const status = apiError.status;

        if (status === 401) {
          return new APIKeyError(this.type, "Invalid API key");
        }
        if (status === 429) {
          const retryAfter = (error as Error & { headers?: { "retry-after"?: string } }).headers?.["retry-after"];
          return new RateLimitError(
            this.type,
            retryAfter ? parseInt(retryAfter, 10) : undefined
          );
        }
        if (status === 404) {
          return new ModelNotAvailableError(this.type, this.model);
        }
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
 * 创建 OpenAI Provider
 */
export function createOpenAIProvider(config: OpenAIProviderConfig): OpenAIProvider {
  return new OpenAIProvider(config);
}