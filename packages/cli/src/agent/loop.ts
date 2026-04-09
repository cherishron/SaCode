/**
 * Agentic Loop — 核心代理循环
 *
 * 参考 Gemini CLI 的三层异步生成器架构：
 * User Input → Context Build → AI Call → Tool Execution → Loop
 */
import type { StreamEvent, AgenticLoopConfig } from "./types.js";
import { ContextManager } from "./context.js";
import { ToolExecutor } from "./executor.js";

const DEFAULT_MAX_ITERATIONS = 25;
const LOOP_DETECTION_THRESHOLD = 3;

export class AgenticLoop {
  private config: AgenticLoopConfig;
  private contextManager: ContextManager;
  private toolExecutor: ToolExecutor;
  private iterationCount = 0;
  private recentToolCalls: string[] = [];

  constructor(
    config: AgenticLoopConfig,
    rootDir: string,
  ) {
    this.config = {
      ...config,
      maxIterations: config.maxIterations || DEFAULT_MAX_ITERATIONS,
    };
    this.contextManager = new ContextManager(rootDir, config.contextWindow);
    this.toolExecutor = new ToolExecutor(config.tools, config.autoApprove);
  }

  /**
   * 执行代理循环 — 使用 AsyncGenerator 产出事件流
   */
  async *run(userMessage: string): AsyncGenerator<StreamEvent> {
    this.iterationCount = 0;
    this.recentToolCalls = [];

    // 收集项目上下文
    const projectContext = await this.contextManager.gatherProjectContext();
    const systemPrompt = this.contextManager.buildSystemPrompt(projectContext);

    // 初始化对话
    this.contextManager.addMessage({ role: "system", content: systemPrompt });
    this.contextManager.addMessage({ role: "user", content: userMessage });

    while (this.iterationCount < this.config.maxIterations) {
      this.iterationCount++;

      // 循环检测
      if (this.detectLoop()) {
        yield { type: "error", message: "Loop detected: repeated tool calls. Breaking." };
        break;
      }

      // 调用 AI — 这里是占位实现，实际需要连接 SaCodeClient
      const response = await this.callAI();

      // 处理纯文本响应
      if (response.content) {
        yield { type: "content", text: response.content };
      }

      // 处理 thinking
      if (response.thinking) {
        yield { type: "thought", text: response.thinking };
      }

      // 如果没有工具调用，循环结束
      if (!response.toolCalls || response.toolCalls.length === 0) {
        yield {
          type: "finished",
          usage: response.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
        break;
      }

      // 执行工具调用
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

        // 将工具结果追加到上下文
        this.contextManager.addMessage({
          role: "tool",
          content: result.success ? result.output : `Error: ${result.error}`,
          toolCallId: toolCall.id,
        });
      }

      // 上下文压缩检查
      this.contextManager.compactHistory(20);
    }

    if (this.iterationCount >= this.config.maxIterations) {
      yield { type: "error", message: `Max iterations (${this.config.maxIterations}) reached.` };
    }
  }

  /**
   * 循环检测 — 检查是否重复调用相同工具
   */
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
   * 调用 AI Provider — 占位实现
   * TODO: 在 Task 5 中连接 SaCodeClient
   */
  private async callAI(): Promise<{
    content?: string;
    thinking?: string;
    toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }> {
    // 占位：返回一个完成响应
    // 实际实现将通过 SaCodeClient 调用 AI Provider
    return {
      content: "AI response placeholder — connect to SaCodeClient in Task 5",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  getIterationCount(): number {
    return this.iterationCount;
  }
}
