/**
 * 任务规划器 — 将复杂任务分解为步骤
 */

export interface TaskStep {
  id: string;
  description: string;
  toolName?: string;
  args?: Record<string, unknown>;
  status: "pending" | "running" | "done" | "error";
  result?: string;
}

export interface TaskPlan {
  goal: string;
  steps: TaskStep[];
  currentStepIndex: number;
}

export class TaskPlanner {
  private plan: TaskPlan | null = null;

  /**
   * 创建执行计划
   */
  createPlan(goal: string, steps: Omit<TaskStep, "id" | "status">[]): TaskPlan {
    this.plan = {
      goal,
      steps: steps.map((s, i) => ({
        ...s,
        id: `step-${i + 1}`,
        status: "pending",
      })),
      currentStepIndex: 0,
    };
    return this.plan;
  }

  /**
   * 获取当前步骤
   */
  getCurrentStep(): TaskStep | null {
    if (!this.plan) return null;
    return this.plan.steps[this.plan.currentStepIndex] ?? null;
  }

  /**
   * 标记当前步骤完成并前进
   */
  completeCurrentStep(result: string): void {
    if (!this.plan) return;
    const step = this.plan.steps[this.plan.currentStepIndex];
    if (step) {
      step.status = "done";
      step.result = result;
      this.plan.currentStepIndex++;
    }
  }

  /**
   * 标记当前步骤失败
   */
  failCurrentStep(error: string): void {
    if (!this.plan) return;
    const step = this.plan.steps[this.plan.currentStepIndex];
    if (step) {
      step.status = "error";
      step.result = error;
    }
  }

  /**
   * 检查计划是否完成
   */
  isComplete(): boolean {
    if (!this.plan) return true;
    return this.plan.currentStepIndex >= this.plan.steps.length;
  }

  getPlan(): TaskPlan | null {
    return this.plan;
  }

  /**
   * 格式化计划为可读文本
   */
  formatPlan(): string {
    if (!this.plan) return "No plan created.";

    const lines = [`Goal: ${this.plan.goal}`, ""];
    for (const step of this.plan.steps) {
      const icon = step.status === "done" ? "✓" : step.status === "error" ? "✗" : step.status === "running" ? "⟳" : "○";
      lines.push(`  ${icon} ${step.description}`);
    }
    return lines.join("\n");
  }
}
