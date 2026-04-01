/**
 * 任务规划器
 *
 * 分析任务需求，生成执行计划，评估复杂度
 * 
 * 基于 OMO 设计，支持任务类别自动分类
 */

import EventEmitter from "eventemitter3";
import type {
  ExecutionPlan,
  TaskStep,
  PlannerOptions,
  ComplexityLevel,
  ComplexityAssessment,
  TaskCategory,
} from "./types";

// ============================================================================
// 规划器事件
// ============================================================================

export interface PlannerEvents {
  /** 计划创建 */
  plan_created: (plan: ExecutionPlan) => void;
  /** 复杂度评估 */
  complexity_assessed: (assessment: ComplexityAssessment) => void;
  /** 步骤添加 */
  step_added: (step: TaskStep) => void;
}

// ============================================================================
// 规划器实现
// ============================================================================

/**
 * 任务规划器
 *
 * 将用户请求分解为可执行的步骤计划
 */
export class Planner extends EventEmitter<PlannerEvents> {
  private options: Required<PlannerOptions>;
  private planCounter = 0;

  constructor(options: PlannerOptions = {}) {
    super();
    this.options = {
      allowParallel: options.allowParallel ?? true,
      maxSteps: options.maxSteps ?? 20,
      autoAssignAgents: options.autoAssignAgents ?? true,
      debug: options.debug ?? false,
    };
  }

  // ============================================================================
  // 规划生成
  // ============================================================================

  /**
   * 根据用户请求生成执行计划
   *
   * @param goal 用户目标/请求
   * @param context 上下文信息
   * @returns 执行计划
   */
  async generatePlan(
    goal: string,
    context?: Record<string, unknown>
  ): Promise<ExecutionPlan> {
    const planId = `plan_${Date.now()}_${++this.planCounter}`;

    // 评估复杂度
    const assessment = this.assessComplexity(goal, context);

    if (this.options.debug) {
      console.log(`[Planner] Complexity assessment:`, assessment);
    }

    // 根据复杂度生成步骤
    const steps = await this.generateSteps(goal, assessment, context);

    // 限制步骤数量
    const limitedSteps = steps.slice(0, this.options.maxSteps);

    // 创建计划
    const plan: ExecutionPlan = {
      id: planId,
      description: `Execution plan for: ${goal.slice(0, 100)}...`,
      goal,
      steps: limitedSteps,
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(context ? { context } : {}),
    };

    this.emit("plan_created", plan);

    if (this.options.debug) {
      console.log(`[Planner] Created plan ${planId} with ${limitedSteps.length} steps`);
    }

    return plan;
  }

  /**
   * 生成执行步骤
   */
  private async generateSteps(
    goal: string,
    assessment: ComplexityAssessment,
    _context?: Record<string, unknown>
  ): Promise<TaskStep[]> {
    const steps: TaskStep[] = [];
    let stepCounter = 0;

    // 根据复杂度级别生成不同粒度的步骤
    switch (assessment.level) {
      case "simple":
        // 简单任务：1-2 个步骤
        steps.push(this.createStep(++stepCounter, `Execute: ${goal}`));
        break;

      case "medium":
        // 中等任务：3-5 个步骤
        steps.push(this.createStep(++stepCounter, "Analyze the request and gather context"));
        steps.push(this.createStep(++stepCounter, "Plan the execution approach"));
        steps.push(this.createStep(++stepCounter, `Execute the main task: ${goal}`));
        steps.push(this.createStep(++stepCounter, "Verify and report results"));
        break;

      case "complex":
        // 复杂任务：5+ 个步骤
        steps.push(this.createStep(++stepCounter, "Understand and analyze the request"));
        steps.push(this.createStep(++stepCounter, "Gather necessary context and resources"));
        steps.push(this.createStep(++stepCounter, "Break down into sub-tasks"));
        steps.push(this.createStep(++stepCounter, "Plan execution strategy"));
        steps.push(this.createStep(++stepCounter, `Execute primary task: ${goal}`));
        steps.push(this.createStep(++stepCounter, "Handle edge cases and errors"));
        steps.push(this.createStep(++stepCounter, "Verify results"));
        steps.push(this.createStep(++stepCounter, "Summarize and report"));
        break;
    }

    // 添加工具分配
    if (this.options.autoAssignAgents) {
      this.assignToolsToSteps(steps, assessment);
    }

    return steps;
  }

  /**
   * 创建步骤
   */
  private createStep(order: number, description: string): TaskStep {
    return {
      id: `step_${order}`,
      description,
      status: "pending",
    };
  }

  /**
   * 为步骤分配工具
   */
  private assignToolsToSteps(
    steps: TaskStep[],
    assessment: ComplexityAssessment
  ): void {
    const toolKeywords: Record<string, string[]> = {
      file: ["read_file", "write_file", "list_directory"],
      search: ["search_files", "browser_navigate"],
      code: ["execute_command", "read_file", "write_file"],
      browser: ["browser_navigate", "browser_click", "browser_screenshot"],
      analysis: ["calculate", "format_json"],
    };

    for (const step of steps) {
      const desc = step.description.toLowerCase();
      const tools: string[] = [];

      // 根据步骤描述匹配工具
      for (const [keyword, keywordTools] of Object.entries(toolKeywords)) {
        if (desc.includes(keyword)) {
          tools.push(...keywordTools);
        }
      }

      if (tools.length > 0) {
        step.tools = [...new Set(tools)];
      }
    }

    // 根据复杂度调整工具分配
    if (assessment.factors.requiresExternalResources) {
      steps.forEach((step) => {
        if (!step.tools) step.tools = [];
        if (!step.tools.includes("browser_navigate")) {
          step.tools.push("browser_navigate");
        }
      });
    }
  }

  // ============================================================================
  // 任务类别分类（基于 OMO 设计）
  // ============================================================================

  /**
   * 分类任务类别
   *
   * 基于 OMO (Oh My OpenCode) 设计，将任务分为四类：
   * - visual-engineering: 前端/UI/UX 任务
   * - deep: 自主研究+执行，深度代码工作
   * - quick: 单文件更改，快速任务
   * - ultrabrain: 硬逻辑/架构决策，复杂推理
   *
   * @param goal 任务目标
   * @returns 任务类别
   */
  classifyCategory(goal: string): TaskCategory {
    const lower = goal.toLowerCase();

    // visual-engineering: UI/前端/样式相关
    if (this.matchesCategory(lower, "visual-engineering")) {
      return "visual-engineering";
    }

    // quick: 简单修改
    if (this.matchesCategory(lower, "quick")) {
      return "quick";
    }

    // ultrabrain: 复杂逻辑/架构决策
    if (this.matchesCategory(lower, "ultrabrain")) {
      return "ultrabrain";
    }

    // deep: 默认类别，深度工作
    return "deep";
  }

  /**
   * 检查是否匹配特定类别
   */
  private matchesCategory(input: string, category: TaskCategory): boolean {
    const categoryKeywords: Record<TaskCategory, { keywords: string[]; patterns: RegExp[] }> = {
      "visual-engineering": {
        keywords: [
          "ui", "界面", "前端", "样式", "组件", "页面", "布局", "设计",
          "css", "tailwind", "动画", "响应式", "移动端", "图标", "颜色",
          "frontend", "style", "component", "layout", "animation", "button", "form",
        ],
        patterns: [
          /(?:style|css|tailwind|styled)/i,
          /(?:component|widget|button|form|modal|card)/i,
          /(?:layout|flexbox|grid|position|center)/i,
          /(?:react|vue|svelte|angular|next)/i,
        ],
      },
      "quick": {
        keywords: [
          "修改", "更新", "添加", "删除", "修复", "更改", "调整",
          "重命名", "单个", "简单", "快速", "typo", "minor",
          "fix", "update", "add", "remove", "change", "rename", "quick",
        ],
        patterns: [
          /(?:fix|update|change)\s+(?:the\s+)?(?:a\s+)?(?:single\s+)?(?:file|line)/i,
          /(?:quick|simple|minor|small)\s+(?:fix|change|update)/i,
          /(?:single|one)\s+(?:file|line|variable)/i,
        ],
      },
      "ultrabrain": {
        keywords: [
          "算法", "逻辑", "架构", "设计", "决策", "分析", "评估",
          "优化", "性能", "安全", "复杂", "核心", "关键",
          "algorithm", "architecture", "design", "decision", "complex",
          "performance", "optimization", "security", "critical",
        ],
        patterns: [
          /(?:architecture|design)\s+(?:decision|pattern|approach)/i,
          /(?:algorithm|logic|complex)\s+(?:implementation|design)/i,
          /(?:performance|optimization)\s+(?:improve|enhance)/i,
          /(?:security|vulnerability)\s+/i,
        ],
      },
      "deep": {
        keywords: [
          "实现", "开发", "构建", "创建", "研究", "分析", "探索",
          "重构", "优化", "迁移", "集成", "系统", "模块",
          "implement", "develop", "build", "create", "research",
          "refactor", "optimize", "migrate", "integrate", "system",
        ],
        patterns: [
          /(?:implement|develop|build|create)\s+(?:a|an|the)?\s*\w+/i,
          /(?:research|analyze|investigate|explore)\s+/i,
          /(?:refactor|optimize|improve)\s+/i,
        ],
      },
    };

    const { keywords, patterns } = categoryKeywords[category];

    // 关键词匹配
    const keywordMatches = keywords.filter((k) => input.includes(k.toLowerCase())).length;
    // 模式匹配
    const patternMatches = patterns.filter((p) => p.test(input)).length;

    // 需要至少 2 个关键词匹配或 1 个模式匹配
    return keywordMatches >= 2 || patternMatches >= 1;
  }

  /**
   * 获取类别对应的推荐模型
   */
  getRecommendedModelForCategory(category: TaskCategory): string | undefined {
    const modelMap: Record<TaskCategory, string[]> = {
      "visual-engineering": ["claude-3-sonnet", "gpt-4o", "gpt-4o-mini"],
      "deep": ["claude-3-opus", "gpt-4o", "deepseek-coder"],
      "quick": ["claude-3-haiku", "gpt-4o-mini", "deepseek-chat"],
      "ultrabrain": ["claude-3-opus", "gpt-4o"],
    };

    return modelMap[category]?.[0];
  }

  // ============================================================================
  // 复杂度评估
  // ============================================================================

  /**
   * 评估任务复杂度
   */
  assessComplexity(
    goal: string,
    _context?: Record<string, unknown>
  ): ComplexityAssessment {
    const factors = this.analyzeFactors(goal);

    // 计算分数（0-100）
    let score = 0;

    // 技术栈数量
    score += Math.min(factors.techStackCount * 10, 20);

    // 工具数量
    score += Math.min(factors.toolCount * 5, 20);

    // 预估步骤数
    score += Math.min(factors.estimatedSteps * 5, 25);

    // 外部资源
    if (factors.requiresExternalResources) score += 15;

    // 用户交互
    if (factors.requiresUserInteraction) score += 10;

    // 长度因素
    if (goal.length > 500) score += 10;

    // 确定复杂度级别
    let level: ComplexityLevel;
    if (score < 30) {
      level = "simple";
    } else if (score < 60) {
      level = "medium";
    } else {
      level = "complex";
    }

    // 分类任务类别（基于 OMO 设计）
    const taskCategory = this.classifyCategory(goal);
    
    // 获取推荐模型
    const recommendedModel = this.getRecommendedModelForCategory(taskCategory);

    const assessment: ComplexityAssessment = {
      level,
      score,
      taskCategory,
      ...(recommendedModel ? { recommendedModel } : {}),
      factors,
      recommendation: this.getRecommendation(level, factors, taskCategory),
    };

    this.emit("complexity_assessed", assessment);

    return assessment;
  }

  /**
   * 分析复杂度因素
   */
  private analyzeFactors(goal: string): ComplexityAssessment["factors"] {
    const lowerGoal = goal.toLowerCase();

    // 技术栈检测
    const techKeywords = [
      "react", "vue", "angular", "node", "python", "typescript", "javascript",
      "sql", "mongodb", "redis", "docker", "kubernetes", "aws", "azure",
    ];
    const techStackCount = techKeywords.filter((t) => lowerGoal.includes(t)).length;

    // 工具需求检测
    const toolKeywords = [
      "file", "read", "write", "search", "browser", "execute", "command",
      "api", "http", "database", "git",
    ];
    const toolCount = toolKeywords.filter((t) => lowerGoal.includes(t)).length;

    // 预估步骤数
    const actionKeywords = [
      "create", "update", "delete", "add", "remove", "modify", "implement",
      "fix", "refactor", "test", "deploy", "build",
    ];
    const estimatedSteps = actionKeywords.filter((t) => lowerGoal.includes(t)).length + 1;

    // 外部资源
    const requiresExternalResources =
      lowerGoal.includes("api") ||
      lowerGoal.includes("http") ||
      lowerGoal.includes("fetch") ||
      lowerGoal.includes("browser") ||
      lowerGoal.includes("website");

    // 用户交互
    const requiresUserInteraction =
      lowerGoal.includes("ask") ||
      lowerGoal.includes("confirm") ||
      lowerGoal.includes("choose") ||
      lowerGoal.includes("select");

    return {
      techStackCount,
      toolCount,
      estimatedSteps,
      requiresExternalResources,
      requiresUserInteraction,
    };
  }

  /**
   * 获取建议
   */
  private getRecommendation(
    level: ComplexityLevel,
    factors: ComplexityAssessment["factors"],
    category: TaskCategory
  ): string {
    const recommendations: Record<ComplexityLevel, string[]> = {
      simple: [
        "This task can be completed in a single interaction.",
        "No special planning required.",
      ],
      medium: [
        "This task requires multiple steps.",
        "Consider breaking it down further if needed.",
      ],
      complex: [
        "This is a complex task requiring careful planning.",
        "Multiple tools and steps are involved.",
        "Consider assigning to a specialized agent.",
      ],
    };

    // 类别建议（基于 OMO 设计）
    const categoryRecommendations: Record<TaskCategory, string> = {
      "visual-engineering": "Task classified as UI/Frontend work. Consider using models with vision capabilities.",
      "deep": "Task requires deep work and autonomous execution. Consider using models with long context.",
      "quick": "Quick task detected. Fast models recommended for efficiency.",
      "ultrabrain": "Complex reasoning task. Top-tier models recommended for accuracy.",
    };

    const baseRecommendations = recommendations[level];
    const additionalRecommendations: string[] = [];

    // 添加类别建议
    additionalRecommendations.push(categoryRecommendations[category]);

    if (factors.requiresExternalResources) {
      additionalRecommendations.push("External resources will be accessed.");
    }

    if (factors.requiresUserInteraction) {
      additionalRecommendations.push("User interaction may be required.");
    }

    if (factors.techStackCount > 2) {
      additionalRecommendations.push("Multiple technologies involved.");
    }

    return [...baseRecommendations, ...additionalRecommendations].join(" ");
  }

  // ============================================================================
  // 任务分解
  // ============================================================================

  /**
   * 分解子任务
   */
  async decomposeTask(
    task: string,
    maxSubtasks: number = 5
  ): Promise<string[]> {
    const assessment = this.assessComplexity(task);

    if (assessment.level === "simple") {
      return [task];
    }

    // 根据复杂度分解
    const subtasks: string[] = [];
    const lines = task.split(/[.!?\n]+/).filter((l) => l.trim().length > 0);

    if (lines.length > 1) {
      // 如果有多行/多句，按行分解
      subtasks.push(...lines.slice(0, maxSubtasks));
    } else {
      // 否则按关键词分解
      const keywords = ["first", "then", "next", "after", "finally"];
      let parts = [task];

      for (const keyword of keywords) {
        const newParts: string[] = [];
        for (const part of parts) {
          const split = part.split(new RegExp(`\\b${keyword}\\b`, "i"));
          newParts.push(...split.filter((s) => s.trim().length > 0));
        }
        if (newParts.length > parts.length) {
          parts = newParts;
        }
      }

      subtasks.push(...parts.slice(0, maxSubtasks));
    }

    // 确保至少有一个子任务
    if (subtasks.length === 0) {
      subtasks.push(task);
    }

    return subtasks;
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建任务规划器
 */
export function createPlanner(options?: PlannerOptions): Planner {
  return new Planner(options);
}
