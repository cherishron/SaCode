# Provider Abstraction Layer - Detail Design

> Detailed design for AI provider abstraction

---

## 1. Provider Interface

### 1.1 Type Definitions

```typescript
// Provider types
type ProviderType = "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu" | string;

// Message types
interface Message {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

// Tool definitions
interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// Stream chunk types
type StreamChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; usage: UsageInfo }
  | { type: "error"; error: ProviderError }
  | { type: "done" };

// Usage information
interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Provider error
class ProviderError extends Error {
  constructor(
    public provider: string,
    public code: string,
    message: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
```

### 1.2 AIProvider Interface

```typescript
interface AIProvider {
  // Properties
  readonly type: ProviderType;
  readonly model: string;
  readonly isInitialized: boolean;

  // Methods
  initialize(): Promise<void>;
  chat(options: ChatOptions): AsyncGenerator<StreamChunk>;
  executeToolCall?(toolCall: ToolCall): Promise<ToolCallResult>;
  registerTool(tool: Tool, handler: ToolHandler): void;
  destroy(): Promise<void>;
}

interface ChatOptions {
  messages: Message[];
  tools?: Tool[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
}
```

---

## 2. Base Provider Implementation

### 2.1 BaseProvider Class

```typescript
abstract class BaseProvider implements AIProvider {
  protected config: ProviderConfig;
  protected tools: Map<string, { tool: Tool; handler: ToolHandler }>;
  protected retryConfig: RetryConfig;

  abstract get type(): ProviderType;
  abstract get model(): string;

  protected constructor(config: ProviderConfig) {
    this.config = config;
    this.tools = new Map();
    this.retryConfig = {
      maxRetries: config.maxRetries ?? 3,
      initialDelay: 1000,
      maxDelay: 10000,
      retryableErrors: ["rate_limit", "timeout", "overloaded"],
    };
  }

  // Retry logic with exponential backoff
  protected async withRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = this.retryConfig.initialDelay;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.retryConfig.maxRetries && this.isRetryableError(error)) {
          await this.sleep(delay);
          delay = Math.min(delay * 2, this.retryConfig.maxDelay);
        } else {
          break;
        }
      }
    }

    throw this.mapError(lastError!);
  }

  // Error classification
  protected isRetryableError(error: Error): boolean {
    if (error instanceof ProviderError) {
      return this.retryConfig.retryableErrors.includes(error.code);
    }
    // Network errors
    const networkErrorCodes = [
      "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED",
      "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "EAI_AGAIN",
    ];
    const errorCode = (error as Error & { code?: string }).code;
    return networkErrorCodes.includes(errorCode ?? "");
  }

  // Sleep utility
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Tool registration
  registerTool(tool: Tool, handler: ToolHandler): void {
    this.tools.set(tool.function.name, { tool, handler });
  }
}
```

---

## 3. OpenAI Provider

### 3.1 Implementation

```typescript
class OpenAIProvider extends BaseProvider {
  private client: OpenAI;
  private modelId: string;

  get type(): ProviderType { return "openai"; }
  get model(): string { return this.modelId; }

  constructor(config: OpenAIConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.modelId = config.model ?? "gpt-4o";
  }

  async *chat(options: ChatOptions): AsyncGenerator<StreamChunk> {
    // Convert messages to OpenAI format
    const messages = this.convertMessages(options.messages);

    // Stream iteration with error recovery
    let streamRetryCount = 0;
    const maxStreamRetries = 1;

    while (streamRetryCount <= maxStreamRetries) {
      try {
        const stream = await this.withRetry(
          () => this.client.chat.completions.create({
            model: this.modelId,
            messages,
            tools: options.tools?.length ? this.convertTools(options.tools) : undefined,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            stream: true,
          }),
          "chat"
        );

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;

          if (delta?.content) {
            yield { type: "text", text: delta.content };
          }

          if (delta?.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              yield {
                type: "tool_call",
                toolCall: {
                  id: toolCall.id,
                  type: "function",
                  function: {
                    name: toolCall.function?.name ?? "",
                    arguments: toolCall.function?.arguments ?? "",
                  },
                },
              };
            }
          }
        }

        return; // Success
      } catch (error) {
        if (streamRetryCount < maxStreamRetries && this.isRetryableError(error)) {
          streamRetryCount++;
          await this.sleep(1000 * streamRetryCount);
          continue;
        }
        yield { type: "error", error: this.mapError(error) };
        return;
      }
    }
  }

  private convertMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map(msg => {
      if (typeof msg.content === "string") {
        return { role: msg.role, content: msg.content };
      }
      return {
        role: msg.role,
        content: msg.content.map(part => {
          if (part.type === "text") return { type: "text", text: part.text };
          return { type: "image_url", image_url: { url: part.image_url!.url } };
        }),
      };
    });
  }
}
```

---

## 4. Anthropic Provider

### 4.1 Implementation

```typescript
class AnthropicProvider extends BaseProvider {
  private client: Anthropic;
  private modelId: string;

  get type(): ProviderType { return "anthropic"; }
  get model(): string { return this.modelId; }

  constructor(config: AnthropicConfig) {
    super(config);
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.modelId = config.model ?? "claude-3-5-sonnet-latest";
  }

  async *chat(options: ChatOptions): AsyncGenerator<StreamChunk> {
    // Extract system message
    const systemMessage = options.messages.find(m => m.role === "system");
    const otherMessages = options.messages.filter(m => m.role !== "system");

    // Tool Use accumulator for parameter accumulation
    const toolUseAccumulator = new Map<number, { id: string; name: string; inputJson: string }>();

    let streamRetryCount = 0;
    const maxStreamRetries = 1;

    while (streamRetryCount <= maxStreamRetries) {
      try {
        const stream = await this.withRetry(
          () => this.client.messages.stream({
            model: this.modelId,
            system: systemMessage?.content as string | undefined,
            messages: this.convertMessages(otherMessages),
            tools: options.tools?.length ? this.convertTools(options.tools) : undefined,
            max_tokens: options.maxTokens ?? 4096,
            temperature: options.temperature,
          }),
          "chat"
        );

        for await (const event of stream) {
          switch (event.type) {
            case "content_block_delta": {
              const delta = event.delta;
              const index = event.index;

              if (delta.type === "text_delta") {
                yield { type: "text", text: delta.text };
              } else if (delta.type === "input_json_delta") {
                // Accumulate tool input JSON
                const accumulator = toolUseAccumulator.get(index);
                if (accumulator && delta.partial_json !== undefined) {
                  accumulator.inputJson += delta.partial_json;
                }
              }
              break;
            }

            case "content_block_start": {
              const block = event.content_block;
              const index = event.index;

              if (block.type === "tool_use") {
                // Initialize accumulator
                toolUseAccumulator.set(index, {
                  id: block.id,
                  name: block.name,
                  inputJson: "",
                });
              }
              break;
            }

            case "content_block_stop": {
              const index = event.index;
              const accumulator = toolUseAccumulator.get(index);

              // Yield complete tool call when block stops
              if (accumulator) {
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
                toolUseAccumulator.delete(index);
              }
              break;
            }
          }
        }

        return;
      } catch (error) {
        if (streamRetryCount < maxStreamRetries && this.isRetryableError(error)) {
          streamRetryCount++;
          await this.sleep(1000 * streamRetryCount);
          continue;
        }
        yield { type: "error", error: this.mapError(error) };
        return;
      }
    }
  }
}
```

---

## 5. Provider Factory

### 5.1 Factory Implementation

```typescript
type ProviderFactory = (config: ProviderConfig) => AIProvider;

const providerFactories: Map<string, ProviderFactory> = new Map([
  ["openai", (config) => new OpenAIProvider(config as OpenAIConfig)],
  ["anthropic", (config) => new AnthropicProvider(config as AnthropicConfig)],
  ["deepseek", (config) => new DeepSeekProvider(config as DeepSeekConfig)],
  ["moonshot", (config) => new MoonshotProvider(config as MoonshotConfig)],
  ["zhipu", (config) => new ZhipuProvider(config as ZhipuConfig)],
]);

function createProvider(config: ProviderConfig & { type: ProviderType }): AIProvider {
  const factory = providerFactories.get(config.type);
  if (!factory) {
    throw new ProviderError(
      config.type,
      "UNKNOWN_PROVIDER",
      `Unknown provider type: ${config.type}`
    );
  }
  return factory(config);
}

function registerProvider(type: string, factory: ProviderFactory): void {
  providerFactories.set(type, factory);
}

function createProviderFromEnv(env?: EnvConfig): AIProvider {
  if (!env) {
    if (typeof process !== "undefined" && process.env) {
      env = process.env as EnvConfig;
    } else {
      throw new ProviderError(
        "unknown",
        "ENV_NOT_AVAILABLE",
        "Environment variables not available. Please pass env config explicitly for Edge Runtime environments."
      );
    }
  }

  const type = (env.AI_PROVIDER ?? env.PROVIDER_TYPE ?? "openai") as ProviderType;
  return createProvider({
    type,
    apiKey: env[`${type.toUpperCase()}_API_KEY`] ?? env.OPENAI_API_KEY ?? "",
    model: env[`${type.toUpperCase()}_MODEL`] ?? env.AI_MODEL,
  });
}
```

---

## 6. Error Handling

### 6.1 Error Mapping

```typescript
protected mapError(error: unknown): ProviderError {
  // OpenAI errors
  if (error instanceof OpenAI.APIError) {
    return new ProviderError(
      "openai",
      error.status?.toString() ?? "api_error",
      error.message,
      error.status === 429 || error.status === 503
    );
  }

  // Anthropic errors
  if (error instanceof Anthropic.APIError) {
    return new ProviderError(
      "anthropic",
      error.status?.toString() ?? "api_error",
      error.message,
      error.status === 429 || error.status === 529
    );
  }

  // Network errors
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return new ProviderError(this.type, "network_error", error.message, true);
  }

  // Generic errors
  if (error instanceof Error) {
    return new ProviderError(this.type, "unknown_error", error.message, false);
  }

  return new ProviderError(this.type, "unknown_error", "Unknown error occurred", false);
}
```

### 6.2 Error Codes

| Code | Description | Retryable |
|------|-------------|-----------|
| `rate_limit` | Rate limit exceeded | Yes |
| `timeout` | Request timeout | Yes |
| `overloaded` | Service overloaded | Yes |
| `invalid_api_key` | Invalid API key | No |
| `insufficient_quota` | Quota exceeded | No |
| `model_not_found` | Model not available | No |
| `context_length_exceeded` | Token limit exceeded | No |
| `network_error` | Network failure | Yes |

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
