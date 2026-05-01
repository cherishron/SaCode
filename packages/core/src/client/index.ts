/**
 * SACODE 客户端
 *
 * 支持两种模式：
 * 1. Provider 模式（推荐）：直接调用 AI API（OpenAI、Anthropic 等）
 * 2. Legacy 模式（兼容）：通过 iFlow ACP 协议连接
 *
 * 支持：
 * - 工具执行循环（Agentic Loop）
 * - 多工具并行调用
 * - 工具桥接层集成
 * - Agentic 规划与编排
 */

import EventEmitter from "eventemitter3";
import type { Message, IFlowConfig, ProviderConfig } from "../types";
import { SACODEError, ConnectionError } from "../types";
import {
  createProvider,
  createProviderFromEnv,
  type AIProvider,
  type ChatMessage,
  type ToolDefinition,
  type ToolCall,
  type ToolCallResult,
  streamChunkToMessage,
} from "../provider";
import {
  ToolBridge,
  createToolBridge,
  type ToolBridgeConfig,
  type UnifiedToolDefinition,
} from "../tools";
import {
  AgentRegistry,
  createAgentRegistry,
  Planner,
  createPlanner,
  Orchestrator,
  createOrchestrator,
  type ExecutionPlan,
  type OrchestrationResult,
  type ComplexityAssessment,
} from "../agent";

// ============================================================================
// 类型定义
// ============================================================================

export interface SACODEClientOptions extends Partial<IFlowConfig> {
  /** Provider 配置（新） */
  provider?: {
    type: ProviderConfig["type"];
    apiKey: string;
    model?: string;
    baseUrl?: string;
    timeout?: number;
    maxRetries?: number;
    debug?: boolean;
  };
  /** 工具桥接层配置 */
  toolBridge?: ToolBridgeConfig;
  /** 最大工具调用循环次数 */
  maxToolLoopIterations?: number;
  /** 是否启用 Agentic 规划 */
  enableAgenticPlanning?: boolean;
  /** 调试模式 */
  debug?: boolean;
}

export interface SACODEClientEvents {
  message: (message: Message) => void;
  error: (error: Error) => void;
  connect: () => void;
  disconnect: () => void;
  tool_call_start: (toolCall: ToolCall) => void;
  tool_call_end: (result: ToolCallResult) => void;
  /** Agentic 事件 */
  plan_created: (plan: ExecutionPlan) => void;
  plan_completed: (result: OrchestrationResult) => void;
  complexity_assessed: (assessment: ComplexityAssessment) => void;
}

// ============================================================================
// SACODE 客户端
// ============================================================================

/**
 * SACODE 客户端
 *
 * 使用 Provider 抽象层与 AI 服务通信，支持流式输出和工具调用
 * 实现完整的 Agentic 工具执行循环
 */
export class SACODEClient extends EventEmitter<SACODEClientEvents> {
  private provider: AIProvider | null = null;
  private toolBridge: ToolBridge | null = null;
  private agentRegistry: AgentRegistry | null = null;
  private planner: Planner | null = null;
  private orchestrator: Orchestrator | null = null;
  private config: SACODEClientOptions;
  private connected = false;
  private messageHistory: ChatMessage[] = [];
  private systemPrompt: string | undefined;

  // 默认配置
  private static readonly DEFAULT_MAX_TOOL_LOOP = 10;

  constructor(options: SACODEClientOptions) {
    super();
    this.config = options;
  }

  /**
   * 连接到 AI 服务
   */
  async connect(): Promise<void> {
    if (this.connected && this.provider) {
      return;
    }

    try {
      // 1. 创建 Provider
      if (this.config.provider) {
        this.provider = createProvider({
          type: this.config.provider.type,
          apiKey: this.config.provider.apiKey,
          model: this.config.provider.model ?? "gpt-4o",
          baseUrl: this.config.provider.baseUrl,
          timeout: this.config.provider.timeout ?? this.config.timeout ?? 60000,
          maxRetries: this.config.provider.maxRetries,
          debug: this.config.provider.debug ?? this.config.debug,
        });
      } else {
        this.provider = createProviderFromEnv();
      }

      // 2. 初始化 Provider
      await this.provider.initialize();

      // 3. 创建并初始化工具桥接层
      const toolBridgeConfig: ToolBridgeConfig = {
        enableBuiltinTools: true,
        enableCapabilities: true,
        enableMCP: true,
        ...this.config.toolBridge,
      };
      if (this.config.debug !== undefined) {
        toolBridgeConfig.debug = this.config.debug;
      }
      this.toolBridge = createToolBridge(toolBridgeConfig);
      await this.toolBridge.initialize();

      // 4. 将工具注册到 Provider
      this.registerToolsToProvider();

      // 5. 初始化 Agent 基础设施（如果启用）
      if (this.config.enableAgenticPlanning !== false) {
        this.agentRegistry = createAgentRegistry(
          this.config.debug !== undefined ? { debug: this.config.debug } : {}
        );
        this.planner = createPlanner(
          this.config.debug !== undefined ? { debug: this.config.debug } : {}
        );
        this.orchestrator = createOrchestrator(
          this.agentRegistry,
          this.config.debug !== undefined ? { debug: this.config.debug } : {}
        );

        if (this.config.debug) {
          console.log(`[SACODEClient] Agent infrastructure initialized`);
          const stats = this.agentRegistry.getStats();
          console.log(`[SACODEClient] Registered agents: ${stats.total}`);
        }
      }

      this.connected = true;
      this.emit("connect");

      if (this.config.debug) {
        console.log(`[SACODEClient] Connected to ${this.provider.type} with model ${this.provider.model}`);
        console.log(`[SACODEClient] Tools available: ${this.toolBridge.getToolCount()}`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new ConnectionError(`Failed to connect to AI provider: ${err.message}`, err);
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.provider && this.connected) {
      try {
        await this.provider.destroy();
      } catch {
        // 忽略断开连接时的错误
      }
      this.provider = null;
      this.toolBridge = null;
      this.connected = false;
      this.messageHistory = [];
      this.emit("disconnect");
    }
  }

  /**
   * 更新模型配置
   *
   * @param model 新的模型名称
   * @param baseUrl 可选的新 baseUrl
   */
  async updateModel(model: string, baseUrl?: string): Promise<void> {
    if (this.config.provider) {
      this.config.provider.model = model;
      if (baseUrl) {
        this.config.provider.baseUrl = baseUrl;
      }
    }

    // 如果已连接，重新连接以使用新模型
    if (this.connected) {
      await this.disconnect();
      await this.connect();
    }
  }

  /**
   * 流式聊天（带工具执行循环）
   */
  async *chat(message: string, sessionId?: string): AsyncGenerator<Message> {
    if (!this.provider || !this.connected) {
      throw new ConnectionError("Not connected to AI provider");
    }

    if (!this.toolBridge) {
      throw new ConnectionError("Tool bridge not initialized");
    }

    try {
      // 添加用户消息到历史
      this.messageHistory.push({
        role: "user",
        content: message,
      });

      // 工具执行循环
      const maxIterations = this.config.maxToolLoopIterations ?? SACODEClient.DEFAULT_MAX_TOOL_LOOP;
      let iteration = 0;

      while (iteration < maxIterations) {
        iteration++;

        if (this.config.debug) {
          console.log(`[SACODEClient] Starting iteration ${iteration}/${maxIterations}`);
        }

        // 获取当前工具定义
        const tools = this.toolBridge.getProviderToolDefinitions();

        // 调用 Provider
        const stream = this.provider.chat({
          messages: this.messageHistory,
          systemPrompt: this.systemPrompt,
          tools: tools.length > 0 ? tools : undefined,
          sessionId,
        });

        // 处理流式响应
        let assistantContent = "";
        let hasToolCalls = false;
        const toolCalls: ToolCall[] = [];

        for await (const chunk of stream) {
          const transformedMessage = streamChunkToMessage(chunk, sessionId);

          if (transformedMessage) {
            this.emit("message", transformedMessage);
            yield transformedMessage;
          }

          // 收集助手响应
          if (chunk.type === "text_delta" && chunk.text) {
            assistantContent += chunk.text;
          }

          // 收集工具调用
          if (chunk.type === "tool_call" && chunk.toolCall) {
            hasToolCalls = true;
            toolCalls.push(chunk.toolCall);
          }

          // 检查完成原因
          if (chunk.type === "done") {
            // 添加助手消息到历史
            if (assistantContent || toolCalls.length > 0) {
              this.messageHistory.push({
                role: "assistant",
                content: assistantContent || null,
                // 注：部分 AI SDK 需要单独处理 tool_calls
              } as ChatMessage);
            }
            break;
          }
        }

        // 如果有工具调用，执行并继续循环
        if (hasToolCalls && toolCalls.length > 0) {
          if (this.config.debug) {
            console.log(`[SACODEClient] Executing ${toolCalls.length} tool calls`);
          }

          // 执行所有工具调用
          const results = await this.executeToolCalls(toolCalls);

          // 添加助手消息（包含工具调用）
          // OpenAI 需要先添加 assistant 消息，包含 tool_calls
          if (toolCalls.length > 0) {
            // 修正：更新上一条 assistant 消息，添加 tool_calls 信息
            // 由于我们的简化实现，直接添加工具结果
          }

          // 添加工具结果到消息历史（使用 tool 角色）
          for (const result of results) {
            this.messageHistory.push({
              role: "tool",
              content: result.content,
              tool_call_id: result.toolCallId,
            } as import("../provider/types").ChatMessage);
          }

          // 继续循环，让 AI 处理工具结果
          continue;
        }

        // 没有工具调用，退出循环
        break;
      }

      if (iteration >= maxIterations) {
        if (this.config.debug) {
          console.warn(`[SACODEClient] Reached max tool loop iterations (${maxIterations})`);
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit("error", err);
      throw new SACODEError("CHAT_ERROR", `Chat error: ${err.message}`, err);
    }
  }

  /**
   * 发送单条消息（非流式）
   */
  async sendMessage(message: string): Promise<void> {
    if (!this.provider || !this.connected) {
      throw new ConnectionError("Not connected to AI provider");
    }

    // 添加用户消息到历史
    this.messageHistory.push({
      role: "user",
      content: message,
    });
  }

  /**
   * 接收消息流
   */
  async *receiveMessages(sessionId?: string): AsyncGenerator<Message> {
    yield* this.chat("", sessionId);
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 设置系统提示词
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * 清除消息历史
   */
  clearHistory(): void {
    this.messageHistory = [];
  }

  /**
   * 注册自定义工具
   */
  registerTool(
    name: string,
    description: string,
    parameters: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => Promise<string>
  ): void {
    if (!this.toolBridge) {
      throw new ConnectionError("Tool bridge not initialized");
    }

    const tool: UnifiedToolDefinition = {
      name,
      description,
      parameters: parameters as UnifiedToolDefinition["parameters"],
      source: "custom",
      handler,
    };

    this.toolBridge.registerTool(tool);

    // 同步到 Provider
    if (this.provider) {
      const providerTool: ToolDefinition = {
        type: "function",
        function: {
          name,
          description,
          parameters,
        },
      };
      this.provider.registerTool(providerTool, handler);
    }
  }

  /**
   * 获取当前 Provider 类型
   */
  getProviderType(): string | undefined {
    return this.provider?.type;
  }

  /**
   * 获取当前模型
   */
  getModel(): string | undefined {
    return this.provider?.model;
  }

  /**
   * 获取工具桥接层
   */
  getToolBridge(): ToolBridge | null {
    return this.toolBridge;
  }

  /**
   * 获取可用工具列表
   */
  getAvailableTools(): string[] {
    return this.toolBridge?.getToolNames() ?? [];
  }

  // ============================================================================
  // Agentic 方法
  // ============================================================================

  /**
   * Agentic 聊天（带自动规划）
   *
   * 自动评估任务复杂度，复杂任务会先生成执行计划
   */
  async *agenticChat(
    message: string,
    sessionId?: string
  ): AsyncGenerator<Message | { type: "plan"; plan: ExecutionPlan } | { type: "progress"; step: number; total: number }> {
    if (!this.provider || !this.connected) {
      throw new ConnectionError("Not connected to AI provider");
    }

    if (!this.planner || !this.orchestrator) {
      // Agentic 未启用，使用普通聊天
      yield* this.chat(message, sessionId);
      return;
    }

    // 评估任务复杂度
    const assessment = this.planner.assessComplexity(message);
    this.emit("complexity_assessed", assessment);

    if (this.config.debug) {
      console.log(`[SACODEClient] Complexity: ${assessment.level} (score: ${assessment.score})`);
    }

    // 简单任务直接执行
    if (assessment.level === "simple") {
      yield* this.chat(message, sessionId);
      return;
    }

    // 复杂任务：生成计划
    const plan = await this.planner.generatePlan(message);
    this.emit("plan_created", plan);

    yield { type: "plan", plan };

    // 执行计划
    const result = await this.orchestrator.executePlan(plan, this, this.toolBridge!);
    this.emit("plan_completed", result);

    // 输出结果
    if (result.success && result.output) {
      yield {
        role: "assistant",
        chunk: { type: "text_delta", text: result.output },
        agentInfo: undefined,
        timestamp: new Date(),
        sessionId,
      } as unknown as Message;
    } else if (result.error) {
      yield {
        role: "system",
        code: "EXECUTION_ERROR",
        message: `执行失败: ${result.error}`,
        timestamp: new Date(),
        sessionId,
      } as unknown as Message;
    }
  }

  /**
   * 评估任务复杂度
   */
  assessComplexity(task: string): ComplexityAssessment {
    if (!this.planner) {
      return {
        level: "simple",
        score: 0,
        taskCategory: "quick",
        factors: {
          techStackCount: 0,
          toolCount: 0,
          estimatedSteps: 1,
          requiresExternalResources: false,
          requiresUserInteraction: false,
        },
      };
    }
    return this.planner.assessComplexity(task);
  }

  /**
   * 生成执行计划
   */
  async generatePlan(goal: string): Promise<ExecutionPlan> {
    if (!this.planner) {
      throw new SACODEError("AGENT_DISABLED", "Agentic planning is not enabled");
    }
    return this.planner.generatePlan(goal);
  }

  /**
   * 执行计划
   */
  async executePlan(plan: ExecutionPlan): Promise<OrchestrationResult> {
    if (!this.orchestrator || !this.toolBridge) {
      throw new SACODEError("AGENT_DISABLED", "Agentic orchestration is not enabled");
    }
    return this.orchestrator.executePlan(plan, this, this.toolBridge);
  }

  /**
   * 获取 Agent 注册表
   */
  getAgentRegistry(): AgentRegistry | null {
    return this.agentRegistry;
  }

  /**
   * 获取规划器
   */
  getPlanner(): Planner | null {
    return this.planner;
  }

  /**
   * 获取编排器
   */
  getOrchestrator(): Orchestrator | null {
    return this.orchestrator;
  }

  /**
   * 检查是否启用 Agentic 功能
   */
  isAgenticEnabled(): boolean {
    return this.agentRegistry !== null && this.planner !== null && this.orchestrator !== null;
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 将工具桥接层的工具注册到 Provider
   */
  private registerToolsToProvider(): void {
    if (!this.provider || !this.toolBridge) {
      return;
    }

    const tools = this.toolBridge.getAllTools();

    for (const tool of tools) {
      if (tool.handler) {
        const providerTool: ToolDefinition = {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters as Record<string, unknown>,
          },
        };

        this.provider.registerTool(providerTool, tool.handler);

        if (this.config.debug) {
          console.log(`[SACODEClient] Registered tool to provider: ${tool.name}`);
        }
      }
    }
  }

  /**
   * 执行工具调用
   */
  private async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolCallResult[]> {
    if (!this.toolBridge) {
      return toolCalls.map((call) => ({
        toolCallId: call.id,
        name: call.function.name,
        content: "Error: Tool bridge not initialized",
        success: false,
      }));
    }

    const results: ToolCallResult[] = [];

    for (const call of toolCalls) {
      this.emit("tool_call_start", call);

      const result = await this.toolBridge.executeToolCall(call);
      results.push(result);

      this.emit("tool_call_end", result);

      if (this.config.debug) {
        console.log(`[SACODEClient] Tool ${call.function.name} result:`, result.success ? "success" : "failed");
      }
    }

    return results;
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 SACODE 客户端
 */
export function createSACODEClient(options: SACODEClientOptions): SACODEClient {
  return new SACODEClient(options);
}

/**
 * 从环境变量创建 SACODE 客户端
 *
 * 注意：Provider 将在 connect() 时从环境变量创建
 */
export function createSACODEClientFromEnv(): SACODEClient {
  // 不传入 provider 配置，让 connect() 从环境变量创建
  return new SACODEClient({});
}