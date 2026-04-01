/**
 * Sisyphus 循环执行系统
 *
 * 基于 OMO (Oh My OpenCode) 设计的 "ultrawork" 机制
 * 实现 "不完成不停止" 的自动循环执行
 *
 * 核心理念：
 * - 自动循环执行直到任务完成
 * - 懒惰检测（Lazy Agent Detection）
 * - 完成度评估
 * - 自动恢复机制
 */

import EventEmitter from "eventemitter3";
import type { ExecutionPlan, OrchestrationResult } from "./types";
import type { Orchestrator } from "./orchestrator";
import type { SACODEClient } from "../client";
import type { ToolBridge } from "../tools";

// ============================================
// 类型定义
// ============================================

/**
 * 循环执行模式
 */
export type LoopMode =
  | "ultrawork"     // 全自动循环直到完成
  | "pciv"          // PCIV 模式，阶段确认
  | "hybrid";       // 混合模式，关键节点确认

/**
 * 完成状态
 */
export type CompletionStatus =
  | "completed"     // 完全完成
  | "partial"       // 部分完成
  | "blocked"       // 被阻塞
  | "failed"        // 失败
  | "idle";         // 空闲（懒惰检测）

/**
 * 懒惰检测结果
 */
export interface LazyDetectionResult {
  /** 是否检测到懒惰行为 */
  isLazy: boolean;
  /** 懒惰类型 */
  lazyType?: "no_progress" | "repeated_actions" | "premature_completion" | "avoidance";
  /** 置信度 (0-1) */
  confidence: number;
  /** 建议的恢复动作 */
  suggestedAction?: string;
  /** 证据 */
  evidence: string[];
}

/**
 * 完成度评估结果
 */
export interface CompletionAssessment {
  /** 完成状态 */
  status: CompletionStatus;
  /** 完成度百分比 (0-100) */
  percentage: number;
  /** 已完成的步骤 */
  completedSteps: string[];
  /** 未完成的步骤 */
  pendingSteps: string[];
  /** 阻塞原因（如果有） */
  blockedReason?: string;
  /** 建议的下一步 */
  suggestedNextSteps: string[];
}

/**
 * Sisyphus 循环配置
 */
export interface SisyphusConfig {
  /** 循环模式 */
  mode: LoopMode;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 完成度阈值（达到此百分比视为完成） */
  completionThreshold: number;
  /** 懒惰检测间隔（毫秒） */
  lazyCheckInterval: number;
  /** 无进度超时时间（毫秒） */
  noProgressTimeout: number;
  /** 是否启用懒惰检测 */
  enableLazyDetection: boolean;
  /** 是否启用自动恢复 */
  enableAutoRecovery: boolean;
  /** 进度回调 */
  onProgress?: (assessment: CompletionAssessment) => void;
  /** 懒惰检测回调 */
  onLazyDetected?: (detection: LazyDetectionResult) => void;
  /** 迭代前回调 */
  onBeforeIteration?: (iteration: number, plan: ExecutionPlan) => boolean;
}

/**
 * 循环事件
 */
export interface SisyphusEvents {
  /** 迭代开始 */
  iteration_start: (iteration: number, plan: ExecutionPlan) => void;
  /** 迭代完成 */
  iteration_complete: (iteration: number, result: OrchestrationResult) => void;
  /** 进度更新 */
  progress: (assessment: CompletionAssessment) => void;
  /** 懒惰检测 */
  lazy_detected: (detection: LazyDetectionResult) => void;
  /** 循环完成 */
  loop_complete: (finalResult: SisyphusResult) => void;
  /** 错误 */
  error: (error: Error, iteration?: number) => void;
}

/**
 * Sisyphus 执行结果
 */
export interface SisyphusResult {
  /** 是否成功 */
  success: boolean;
  /** 最终完成度 */
  completionPercentage: number;
  /** 总迭代次数 */
  totalIterations: number;
  /** 所有迭代结果 */
  iterationResults: OrchestrationResult[];
  /** 最终计划状态 */
  finalPlan: ExecutionPlan;
  /** 执行时间（毫秒） */
  duration: number;
  /** 懒惰检测记录 */
  lazyDetections: LazyDetectionResult[];
}

// ============================================
// SisyphusLoop 实现
// ============================================

/**
 * Sisyphus 循环执行器
 *
 * 实现 "不完成不停止" 的自动循环执行机制
 */
export class SisyphusLoop extends EventEmitter<SisyphusEvents> {
  private config: Required<Omit<SisyphusConfig, "onProgress" | "onLazyDetected" | "onBeforeIteration">> & Pick<SisyphusConfig, "onProgress" | "onLazyDetected" | "onBeforeIteration">;
  private orchestrator: Orchestrator;
  private currentIteration = 0;
  private lastProgressTime = 0;
  private lastProgressValue = 0;
  private actionHistory: string[] = [];
  private isRunning = false;

  constructor(orchestrator: Orchestrator, config: Partial<SisyphusConfig> = {}) {
    super();
    this.orchestrator = orchestrator;
    this.config = {
      mode: config.mode ?? "ultrawork",
      maxIterations: config.maxIterations ?? 50,
      completionThreshold: config.completionThreshold ?? 95,
      lazyCheckInterval: config.lazyCheckInterval ?? 30000,
      noProgressTimeout: config.noProgressTimeout ?? 120000,
      enableLazyDetection: config.enableLazyDetection ?? true,
      enableAutoRecovery: config.enableAutoRecovery ?? true,
      ...(config.onProgress ? { onProgress: config.onProgress } : {}),
      ...(config.onLazyDetected ? { onLazyDetected: config.onLazyDetected } : {}),
      ...(config.onBeforeIteration ? { onBeforeIteration: config.onBeforeIteration } : {}),
    };
  }

  // ============================================
  // 主执行循环
  // ============================================

  /**
   * 执行 Sisyphus 循环
   *
   * @param plan 执行计划
   * @param client SACODE 客户端
   * @param toolBridge 工具桥接层
   */
  async execute(
    plan: ExecutionPlan,
    client: SACODEClient,
    toolBridge: ToolBridge
  ): Promise<SisyphusResult> {
    if (this.isRunning) {
      throw new Error("Sisyphus loop is already running");
    }

    this.isRunning = true;
    this.currentIteration = 0;
    this.actionHistory = [];
    const startTime = Date.now();
    const iterationResults: OrchestrationResult[] = [];
    const lazyDetections: LazyDetectionResult[] = [];

    try {
      while (this.currentIteration < this.config.maxIterations) {
        this.currentIteration++;

        // 检查是否应该继续
        if (this.config.onBeforeIteration) {
          const shouldContinue = this.config.onBeforeIteration(this.currentIteration, plan);
          if (!shouldContinue) {
            break;
          }
        }

        this.emit("iteration_start", this.currentIteration, plan);

        // 执行一次迭代
        const result = await this.orchestrator.executePlan(plan, client, toolBridge);
        iterationResults.push(result);

        this.emit("iteration_complete", this.currentIteration, result);

        // 记录动作历史
        this.recordActions(plan);

        // 评估完成度
        const assessment = this.assessCompletion(plan);
        this.emit("progress", assessment);

        if (this.config.onProgress) {
          this.config.onProgress(assessment);
        }

        // 检查是否完成
        if (assessment.percentage >= this.config.completionThreshold) {
          break;
        }

        // 懒惰检测
        if (this.config.enableLazyDetection) {
          const lazyDetection = this.detectLazyBehavior(assessment);
          if (lazyDetection.isLazy) {
            lazyDetections.push(lazyDetection);
            this.emit("lazy_detected", lazyDetection);

            if (this.config.onLazyDetected) {
              this.config.onLazyDetected(lazyDetection);
            }

            // 自动恢复
            if (this.config.enableAutoRecovery && lazyDetection.suggestedAction) {
              await this.recoverFromLazy(lazyDetection, plan);
            }
          }
        }

        // 检查阻塞状态
        if (assessment.status === "blocked") {
          // 尝试解决阻塞
          const unblocked = await this.handleBlocked(plan, assessment.blockedReason);
          if (!unblocked) {
            break;
          }
        }

        // 等待下一次迭代
        await this.waitInterval();
      }

      // 计算最终结果
      const finalAssessment = this.assessCompletion(plan);
      const result: SisyphusResult = {
        success: finalAssessment.percentage >= this.config.completionThreshold,
        completionPercentage: finalAssessment.percentage,
        totalIterations: this.currentIteration,
        iterationResults,
        finalPlan: plan,
        duration: Date.now() - startTime,
        lazyDetections,
      };

      this.emit("loop_complete", result);

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit("error", err, this.currentIteration);

      return {
        success: false,
        completionPercentage: this.assessCompletion(plan).percentage,
        totalIterations: this.currentIteration,
        iterationResults,
        finalPlan: plan,
        duration: Date.now() - startTime,
        lazyDetections,
      };
    } finally {
      this.isRunning = false;
    }
  }

  // ============================================
  // 完成度评估
  // ============================================

  /**
   * 评估计划完成度
   */
  assessCompletion(plan: ExecutionPlan): CompletionAssessment {
    const steps = plan.steps;
    const completedSteps: string[] = [];
    const pendingSteps: string[] = [];
    let blockedReason: string | undefined;

    for (const step of steps) {
      if (step.status === "completed") {
        completedSteps.push(step.id);
      } else {
        pendingSteps.push(step.id);

        // 检查是否被阻塞
        if (step.status === "failed" && step.error) {
          blockedReason = step.error;
        }
      }
    }

    const percentage = steps.length > 0
      ? Math.round((completedSteps.length / steps.length) * 100)
      : 0;

    let status: CompletionStatus;
    if (percentage >= this.config.completionThreshold) {
      status = "completed";
    } else if (blockedReason) {
      status = "blocked";
    } else if (pendingSteps.length === 0) {
      status = "completed";
    } else {
      status = "partial";
    }

    // 更新进度追踪
    if (percentage > this.lastProgressValue) {
      this.lastProgressValue = percentage;
      this.lastProgressTime = Date.now();
    }

    return {
      status,
      percentage,
      completedSteps,
      pendingSteps,
      ...(blockedReason ? { blockedReason } : {}),
      suggestedNextSteps: this.suggestNextSteps(plan),
    };
  }

  /**
   * 建议下一步操作
   */
  private suggestNextSteps(plan: ExecutionPlan): string[] {
    const suggestions: string[] = [];
    const pendingSteps = plan.steps.filter((s) => s.status === "pending");

    for (const step of pendingSteps.slice(0, 3)) {
      suggestions.push(`Execute: ${step.description}`);
    }

    return suggestions;
  }

  // ============================================
  // 懒惰检测
  // ============================================

  /**
   * 检测懒惰行为
   */
  detectLazyBehavior(assessment: CompletionAssessment): LazyDetectionResult {
    const evidence: string[] = [];

    // 1. 检测无进度
    const timeSinceProgress = Date.now() - this.lastProgressTime;
    if (timeSinceProgress > this.config.noProgressTimeout && this.currentIteration > 1) {
      evidence.push(`No progress for ${Math.round(timeSinceProgress / 1000)}s`);
      return {
        isLazy: true,
        lazyType: "no_progress",
        confidence: 0.8,
        suggestedAction: "Force progress by re-evaluating task priorities",
        evidence,
      };
    }

    // 2. 检测重复动作
    const recentActions = this.actionHistory.slice(-10);
    const uniqueActions = new Set(recentActions);
    if (recentActions.length >= 5 && uniqueActions.size <= 2) {
      evidence.push(`Repeated actions detected: ${recentActions.join(", ")}`);
      return {
        isLazy: true,
        lazyType: "repeated_actions",
        confidence: 0.7,
        suggestedAction: "Break the loop by trying a different approach",
        evidence,
      };
    }

    // 3. 检测过早完成声明
    if (assessment.status === "partial" && assessment.percentage < 50) {
      // 检查是否有步骤被跳过但没有合理理由
      const skippedSteps = this.actionHistory.filter((a) => a.includes("skip"));
      if (skippedSteps.length > 2) {
        evidence.push("Multiple steps skipped without completion");
        return {
          isLazy: true,
          lazyType: "premature_completion",
          confidence: 0.6,
          suggestedAction: "Review skipped steps and ensure they are properly handled",
          evidence,
        };
      }
    }

    // 4. 检测回避行为
    const avoidanceKeywords = ["later", "skip", "ignore", "postpone", "defer"];
    const recentActionsStr = this.actionHistory.slice(-5).join(" ").toLowerCase();
    for (const keyword of avoidanceKeywords) {
      if (recentActionsStr.includes(keyword)) {
        evidence.push(`Avoidance behavior detected: ${keyword}`);
        return {
          isLazy: true,
          lazyType: "avoidance",
          confidence: 0.5,
          suggestedAction: "Address the avoided task directly",
          evidence,
        };
      }
    }

    return {
      isLazy: false,
      confidence: 0,
      evidence: [],
    };
  }

  // ============================================
  // 恢复机制
  // ============================================

  /**
   * 从懒惰状态恢复
   */
  private async recoverFromLazy(
    detection: LazyDetectionResult,
    plan: ExecutionPlan
  ): Promise<void> {
    switch (detection.lazyType) {
      case "no_progress":
        // 重新评估任务优先级
        this.reprioritizeSteps(plan);
        break;

      case "repeated_actions":
        // 强制尝试不同方法
        await this.tryAlternativeApproach(plan);
        break;

      case "premature_completion":
        // 重新启用被跳过的步骤
        this.reactivateSkippedSteps(plan);
        break;

      case "avoidance":
        // 标记回避的任务为高优先级
        this.markAvoidedTasks(plan);
        break;
    }
  }

  /**
   * 重新优先级排序步骤
   */
  private reprioritizeSteps(plan: ExecutionPlan): void {
    const pendingSteps = plan.steps.filter((s) => s.status === "pending");
    if (pendingSteps.length > 0) {
      // 将第一个待处理步骤移到前面
      const firstPending = pendingSteps[0];
      if (firstPending) {
        firstPending.priority = 100;
      }
    }
  }

  /**
   * 尝试替代方法
   */
  private async tryAlternativeApproach(_plan: ExecutionPlan): Promise<void> {
    // 清空动作历史以打破循环
    this.actionHistory = [];
  }

  /**
   * 重新激活被跳过的步骤
   */
  private reactivateSkippedSteps(plan: ExecutionPlan): void {
    for (const step of plan.steps) {
      if (step.status === "skipped") {
        step.status = "pending";
        delete step.error;
      }
    }
  }

  /**
   * 标记回避的任务
   */
  private markAvoidedTasks(plan: ExecutionPlan): void {
    for (const step of plan.steps) {
      if (step.status === "pending") {
        step.priority = (step.priority ?? 0) + 10;
      }
    }
  }

  // ============================================
  // 阻塞处理
  // ============================================

  /**
   * 处理阻塞状态
   */
  private async handleBlocked(
    plan: ExecutionPlan,
    _reason?: string
  ): Promise<boolean> {
    // 尝试修复失败的步骤
    const failedSteps = plan.steps.filter((s) => s.status === "failed");

    for (const step of failedSteps) {
      // 重置失败步骤
      step.status = "pending";
      delete step.error;
    }

    return failedSteps.length > 0;
  }

  // ============================================
  // 辅助方法
  // ============================================

  /**
   * 记录动作历史
   */
  private recordActions(plan: ExecutionPlan): void {
    const recentSteps = plan.steps.slice(-5);
    for (const step of recentSteps) {
      if (step.status === "completed" || step.status === "failed") {
        this.actionHistory.push(`${step.id}:${step.status}`);
      }
    }

    // 保持历史记录在合理大小
    if (this.actionHistory.length > 100) {
      this.actionHistory = this.actionHistory.slice(-50);
    }
  }

  /**
   * 等待间隔
   */
  private async waitInterval(): Promise<void> {
    if (this.config.lazyCheckInterval > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(this.config.lazyCheckInterval, 1000))
      );
    }
  }

  // ============================================
  // 状态控制
  // ============================================

  /**
   * 停止循环
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * 检查是否正在运行
   */
  isCurrentlyRunning(): boolean {
    return this.isRunning;
  }

  /**
   * 获取当前迭代次数
   */
  getCurrentIteration(): number {
    return this.currentIteration;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SisyphusConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 Sisyphus 循环执行器
 */
export function createSisyphusLoop(
  orchestrator: Orchestrator,
  config?: Partial<SisyphusConfig>
): SisyphusLoop {
  return new SisyphusLoop(orchestrator, config);
}
