/**
 * Agent 编排器
 *
 * 协调多个 Agent 执行计划，管理执行状态和结果
 */

import EventEmitter from "eventemitter3";
import type { SaClawClient } from "../client";
import type { ToolBridge } from "../tools";
import type { AgentRegistry } from "./registry";
import type {
  ExecutionPlan,
  TaskStep,
  OrchestrationEvent,
  OrchestrationResult,
  OrchestratorConfig,
  OrchestrationEventType,
  Agent,
} from "./types";

// ============================================================================
// 编排器事件
// ============================================================================

export interface OrchestratorEvents {
  /** 事件 */
  event: (event: OrchestrationEvent) => void;
  /** 进度更新 */
  progress: (planId: string, completedSteps: number, totalSteps: number) => void;
  /** 错误 */
  error: (error: Error, planId?: string) => void;
}

// ============================================================================
// 执行上下文
// ============================================================================

interface ExecutionContext {
  plan: ExecutionPlan;
  client: SaClawClient;
  toolBridge: ToolBridge;
  results: Map<string, string>;
  startTime: number;
}

// ============================================================================
// 编排器实现
// ============================================================================

/**
 * Agent 编排器
 *
 * 管理计划执行、Agent 分配和结果收集
 */
export class Orchestrator extends EventEmitter<OrchestratorEvents> {
  private registry: AgentRegistry;
  private config: Required<OrchestratorConfig>;
  private activePlans: Map<string, ExecutionContext> = new Map();

  constructor(
    registry: AgentRegistry,
    config: OrchestratorConfig = {}
  ) {
    super();
    this.registry = registry;
    this.config = {
      maxParallelSteps: config.maxParallelSteps ?? 3,
      stepTimeout: config.stepTimeout ?? 120000,
      maxRetries: config.maxRetries ?? 2,
      continueOnFailure: config.continueOnFailure ?? false,
      debug: config.debug ?? false,
    };
  }

  // ============================================================================
  // 计划执行
  // ============================================================================

  /**
   * 执行计划
   *
   * @param plan 执行计划
   * @param client SaClaw 客户端
   * @param toolBridge 工具桥接层
   */
  async executePlan(
    plan: ExecutionPlan,
    client: SaClawClient,
    toolBridge: ToolBridge
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const context: ExecutionContext = {
      plan,
      client,
      toolBridge,
      results: new Map(),
      startTime,
    };

    // 存储活动计划
    this.activePlans.set(plan.id, context);

    try {
      // 更新计划状态
      plan.status = "executing";
      plan.updatedAt = new Date();

      this.emitEvent(plan.id, "plan_created", { plan });

      // 执行步骤
      await this.executeSteps(context);

      // 计算结果
      const completedSteps = plan.steps.filter(
        (s) => s.status === "completed"
      ).length;

      const success = completedSteps === plan.steps.length;
      plan.status = success ? "completed" : "failed";
      plan.completedAt = new Date();

      const result: OrchestrationResult = {
        planId: plan.id,
        success,
        completedSteps,
        totalSteps: plan.steps.length,
        output: this.collectOutput(context),
        duration: Date.now() - startTime,
      };

      this.emitEvent(plan.id, success ? "plan_completed" : "plan_failed", { result });

      return result;
    } catch (error) {
      plan.status = "failed";
      plan.completedAt = new Date();

      const err = error instanceof Error ? error : new Error(String(error));
      this.emit("error", err, plan.id);

      return {
        planId: plan.id,
        success: false,
        completedSteps: plan.steps.filter((s) => s.status === "completed").length,
        totalSteps: plan.steps.length,
        error: err.message,
        duration: Date.now() - startTime,
      };
    } finally {
      this.activePlans.delete(plan.id);
    }
  }

  /**
   * 执行步骤
   */
  private async executeSteps(context: ExecutionContext): Promise<void> {
    const { plan, client, toolBridge } = context;
    const pendingSteps = plan.steps.filter((s) => s.status === "pending");

    // 按依赖关系排序
    const sortedSteps = this.sortStepsByDependencies(pendingSteps);

    for (const step of sortedSteps) {
      // 检查依赖是否完成
      if (!this.checkDependencies(step, context)) {
        if (this.config.continueOnFailure) {
          step.status = "skipped";
          continue;
        }
        throw new Error(`Dependencies not satisfied for step ${step.id}`);
      }

      // 分配 Agent
      const agent = this.assignAgent(step);
      if (agent) {
        step.assignedAgent = agent.config.id;
        this.emitEvent(plan.id, "agent_assigned", { stepId: step.id, agentId: agent.config.id });
      }

      // 执行步骤
      await this.executeStep(step, context, client, toolBridge);

      // 发送进度更新
      const completedCount = plan.steps.filter((s) => s.status === "completed").length;
      this.emit("progress", plan.id, completedCount, plan.steps.length);
    }
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    step: TaskStep,
    context: ExecutionContext,
    client: SaClawClient,
    toolBridge: ToolBridge
  ): Promise<void> {
    step.status = "running";
    step.startedAt = new Date();

    this.emitEvent(context.plan.id, "step_started", { stepId: step.id });

    let retries = 0;
    let lastError: Error | null = null;

    while (retries <= this.config.maxRetries) {
      try {
        // 构建执行提示词
        const prompt = this.buildStepPrompt(step, context);

        // 执行
        let response = "";
        for await (const msg of client.chat(prompt)) {
          if ("chunk" in msg && msg.chunk?.text) {
            response += msg.chunk.text;
          }
        }

        // 检查是否有工具调用
        const toolNames = toolBridge.getToolNames();
        const usedTools = toolNames.filter((name) => response.includes(name));

        if (usedTools.length > 0) {
          step.tools = usedTools;
        }

        step.output = response;
        step.status = "completed";
        step.completedAt = new Date();

        // 存储结果
        context.results.set(step.id, response);

        this.emitEvent(context.plan.id, "step_completed", {
          stepId: step.id,
          output: response,
        });

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retries++;

        if (this.config.debug) {
          console.log(`[Orchestrator] Step ${step.id} attempt ${retries} failed:`, lastError.message);
        }

        if (retries <= this.config.maxRetries) {
          // 等待后重试
          await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
        }
      }
    }

    // 所有重试失败
    step.status = "failed";
    step.error = lastError?.message ?? "Unknown error";
    step.completedAt = new Date();

    this.emitEvent(context.plan.id, "step_failed", {
      stepId: step.id,
      error: step.error,
    });

    if (!this.config.continueOnFailure) {
      throw new Error(`Step ${step.id} failed: ${step.error}`);
    }
  }

  // ============================================================================
  // Agent 分配
  // ============================================================================

  /**
   * 为步骤分配 Agent
   */
  private assignAgent(step: TaskStep): Agent | undefined {
    // 确定首选类型
    let preferredType: Agent["config"]["type"] | undefined;

    const desc = step.description.toLowerCase();
    if (desc.includes("code") || desc.includes("implement") || desc.includes("debug")) {
      preferredType = "code";
    } else if (desc.includes("research") || desc.includes("search") || desc.includes("find")) {
      preferredType = "research";
    } else if (desc.includes("execute") || desc.includes("run") || desc.includes("command")) {
      preferredType = "execution";
    } else if (desc.includes("analyze") || desc.includes("review")) {
      preferredType = "analysis";
    }

    return this.registry.getBestAgent(step.tools, preferredType);
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  /**
   * 按依赖关系排序步骤
   */
  private sortStepsByDependencies(steps: TaskStep[]): TaskStep[] {
    // 简单拓扑排序
    const sorted: TaskStep[] = [];
    const remaining = [...steps];
    const completed = new Set<string>();

    while (remaining.length > 0) {
      let progress = false;

      for (let i = remaining.length - 1; i >= 0; i--) {
        const step = remaining[i];
        if (!step) continue;

        const deps = step.dependencies ?? [];

        if (deps.every((d) => completed.has(d))) {
          sorted.push(step);
          completed.add(step.id);
          remaining.splice(i, 1);
          progress = true;
        }
      }

      if (!progress) {
        // 循环依赖或无法解决，按原顺序添加剩余步骤
        sorted.push(...remaining.filter((s): s is TaskStep => s !== undefined));
        break;
      }
    }

    return sorted;
  }

  /**
   * 检查步骤依赖是否满足
   */
  private checkDependencies(step: TaskStep, context: ExecutionContext): boolean {
    const deps = step.dependencies ?? [];
    return deps.every((depId) => {
      const depStep = context.plan.steps.find((s) => s.id === depId);
      return depStep?.status === "completed";
    });
  }

  /**
   * 构建步骤执行提示词
   */
  private buildStepPrompt(step: TaskStep, context: ExecutionContext): string {
    const previousResults: string[] = [];

    // 收集前置步骤的结果
    for (const depId of step.dependencies ?? []) {
      const result = context.results.get(depId);
      if (result) {
        previousResults.push(`[${depId}]: ${result.slice(0, 500)}...`);
      }
    }

    let prompt = `Task: ${step.description}\n\n`;

    if (previousResults.length > 0) {
      prompt += `Previous step results:\n${previousResults.join("\n\n")}\n\n`;
    }

    if (step.tools && step.tools.length > 0) {
      prompt += `Available tools: ${step.tools.join(", ")}\n\n`;
    }

    prompt += "Please complete this step and provide the result.";

    return prompt;
  }

  /**
   * 收集最终输出
   */
  private collectOutput(context: ExecutionContext): string {
    const outputs: string[] = [];

    for (const step of context.plan.steps) {
      if (step.status === "completed" && step.output) {
        outputs.push(`## ${step.description}\n${step.output}`);
      }
    }

    return outputs.join("\n\n---\n\n");
  }

  /**
   * 发送事件
   */
  private emitEvent(
    planId: string,
    type: OrchestrationEventType,
    data?: unknown
  ): void {
    const event: OrchestrationEvent = {
      type,
      planId,
      data,
      timestamp: new Date(),
    };

    this.emit("event", event);
  }

  // ============================================================================
  // 状态查询
  // ============================================================================

  /**
   * 获取活动计划数量
   */
  getActivePlanCount(): number {
    return this.activePlans.size;
  }

  /**
   * 检查计划是否正在执行
   */
  isPlanActive(planId: string): boolean {
    return this.activePlans.has(planId);
  }

  /**
   * 取消计划执行
   */
  cancelPlan(planId: string): boolean {
    const context = this.activePlans.get(planId);
    if (!context) {
      return false;
    }

    // 标记所有运行中的步骤为失败
    for (const step of context.plan.steps) {
      if (step?.status === "running") {
        step.status = "failed";
        step.error = "Cancelled";
      }
    }

    context.plan.status = "failed";
    this.activePlans.delete(planId);

    return true;
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Agent 编排器
 */
export function createOrchestrator(
  registry: AgentRegistry,
  config?: OrchestratorConfig
): Orchestrator {
  return new Orchestrator(registry, config);
}
