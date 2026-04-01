/**
 * IntentGate - 意图门控
 *
 * 基于 OMO (Oh My OpenCode) 设计
 * 
 * 验证 Agent 的意图是否与任务一致：
 * - 分析 Agent 行为是否符合任务目标
 * - 检测意图漂移（Intent Drift）
 * - 阻止偏离目标的行为
 */

import EventEmitter from "eventemitter3";

// ============================================
// 类型定义
// ============================================

/**
 * 意图验证结果
 */
export type IntentVerdict =
  | "approved"       // 批准执行
  | "warning"        // 警告但允许
  | "rejected"       // 拒绝执行
  | "clarification"; // 需要澄清

/**
 * 意图检查结果
 */
export interface IntentCheckResult {
  /** 判定结果 */
  verdict: IntentVerdict;
  /** 置信度 (0-1) */
  confidence: number;
  /** 匹配的关键词 */
  matchedKeywords: string[];
  /** 不匹配的行为 */
  mismatches: string[];
  /** 建议的修正 */
  suggestions: string[];
  /** 原因说明 */
  reason: string;
}

/**
 * 行为记录
 */
export interface ActionRecord {
  /** 行为类型 */
  type: string;
  /** 行为描述 */
  description: string;
  /** 目标 */
  target?: string;
  /** 时间戳 */
  timestamp: Date;
  /** 相关文件 */
  files?: string[];
  /** 相关代码片段 */
  codeSnippet?: string;
}

/**
 * 低置信度行为记录
 */
export interface LowConfidenceRecord {
  /** 行为记录 */
  action: ActionRecord;
  /** 置信度 */
  confidence: number;
  /** 判定结果 */
  verdict: IntentVerdict;
  /** 时间戳 */
  timestamp: Date;
}

/**
 * 漂移检测结果
 */
export interface DriftDetectionResult {
  /** 是否检测到漂移 */
  isDrifting: boolean;
  /** 漂移类型 */
  driftType?: "low_confidence" | "repetitive" | "scattered" | "suspicious";
  /** 置信度 */
  confidence: number;
  /** 详情 */
  details: string;
}

/**
 * IntentGate 事件
 */
export interface IntentGateEvents {
  /** 意图检查 */
  checked: (result: IntentCheckResult, action: ActionRecord) => void;
  /** 意图漂移检测 */
  drift_detected: (action: ActionRecord, drift: string) => void;
  /** 行为批准 */
  approved: (action: ActionRecord) => void;
  /** 行为拒绝 */
  rejected: (action: ActionRecord, reason: string) => void;
}

/**
 * IntentGate 配置
 */
export interface IntentGateConfig {
  /** 是否启用意图门控 */
  enabled: boolean;
  /** 批准阈值 (0-1) */
  approvalThreshold: number;
  /** 警告阈值 (0-1) */
  warningThreshold: number;
  /** 是否自动拒绝低置信度行为 */
  autoRejectLowConfidence: boolean;
  /** 低置信度阈值 */
  lowConfidenceThreshold: number;
  /** 关键文件保护模式 */
  protectedFiles: string[];
  /** 禁止的行为类型 */
  forbiddenActions: string[];
}

/**
 * 任务上下文
 */
export interface TaskContext {
  /** 原始任务描述 */
  task: string;
  /** 任务关键词 */
  keywords: string[];
  /** 相关文件 */
  relevantFiles: string[];
  /** 允许的操作 */
  allowedOperations: string[];
  /** 禁止的操作 */
  forbiddenOperations: string[];
}

// ============================================
// IntentGate 实现
// ============================================

/**
 * 意图门控
 */
export class IntentGate extends EventEmitter<IntentGateEvents> {
  private config: Required<IntentGateConfig>;
  private taskContext: TaskContext | undefined = undefined;
  private actionHistory: ActionRecord[] = [];
  private lowConfidenceHistory: LowConfidenceRecord[] = [];
  private driftCounter = 0;

  constructor(config: Partial<IntentGateConfig> = {}) {
    super();
    this.config = {
      enabled: config.enabled ?? true,
      approvalThreshold: config.approvalThreshold ?? 0.7,
      warningThreshold: config.warningThreshold ?? 0.5,
      autoRejectLowConfidence: config.autoRejectLowConfidence ?? true,
      lowConfidenceThreshold: config.lowConfidenceThreshold ?? 0.3,
      protectedFiles: config.protectedFiles ?? [
        ".env",
        "*.key",
        "*.pem",
        "secrets.*",
        "credentials.*",
      ],
      forbiddenActions: config.forbiddenActions ?? [
        "delete_database",
        "drop_table",
        "truncate_table",
        "execute_shell_rm",
        "format_disk",
        "clear_logs",
      ],
    };
  }

  // ============================================
  // 任务上下文设置
  // ============================================

  /**
   * 设置任务上下文
   */
  setTaskContext(context: TaskContext): void {
    this.taskContext = context;
    this.actionHistory = [];
    this.driftCounter = 0;
  }

  /**
   * 从任务描述提取上下文
   */
  extractContext(task: string): TaskContext {
    // 简单的关键词提取
    const keywords = this.extractKeywords(task);

    // 提取可能的文件路径
    const filePattern = /[a-zA-Z0-9_\-/.]+\.[a-zA-Z]{1,5}/g;
    const relevantFiles = task.match(filePattern) ?? [];

    // 根据关键词推断允许的操作
    const allowedOperations = this.inferAllowedOperations(task);

    return {
      task,
      keywords,
      relevantFiles,
      allowedOperations,
      forbiddenOperations: this.config.forbiddenActions,
    };
  }

  /**
   * 提取关键词
   */
  private extractKeywords(text: string): string[] {
    // 移除常见停用词
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been",
      "being", "have", "has", "had", "do", "does", "did", "will",
      "would", "could", "should", "may", "might", "must", "shall",
      "can", "need", "dare", "ought", "used", "to", "of", "in",
      "for", "on", "with", "at", "by", "from", "as", "into",
      "through", "during", "before", "after", "above", "below",
      "between", "under", "again", "further", "then", "once",
      "here", "there", "when", "where", "why", "how", "all",
      "each", "few", "more", "most", "other", "some", "such",
      "only", "own", "same", "so", "than", "too", "very", "just",
    ]);

    // 分词并过滤
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1 && !stopWords.has(word));

    return [...new Set(words)];
  }

  /**
   * 推断允许的操作
   */
  private inferAllowedOperations(task: string): string[] {
    const lowerTask = task.toLowerCase();
    const operations: string[] = [];

    // 根据任务关键词推断
    if (lowerTask.includes("read") || lowerTask.includes("查看") || lowerTask.includes("阅读")) {
      operations.push("read_file", "list_directory", "search_files");
    }
    if (lowerTask.includes("write") || lowerTask.includes("创建") || lowerTask.includes("修改")) {
      operations.push("write_file", "edit_file");
    }
    if (lowerTask.includes("search") || lowerTask.includes("搜索") || lowerTask.includes("查找")) {
      operations.push("search_files", "grep");
    }
    if (lowerTask.includes("run") || lowerTask.includes("执行") || lowerTask.includes("运行")) {
      operations.push("execute_command");
    }
    if (lowerTask.includes("test") || lowerTask.includes("测试")) {
      operations.push("execute_command", "read_file", "write_file");
    }
    if (lowerTask.includes("build") || lowerTask.includes("构建") || lowerTask.includes("编译")) {
      operations.push("execute_command", "read_file", "write_file");
    }

    // 默认允许读取操作
    if (operations.length === 0) {
      operations.push("read_file", "list_directory", "search_files");
    }

    return operations;
  }

  // ============================================
  // 意图检查
  // ============================================

  /**
   * 检查行为意图
   */
  checkIntent(action: ActionRecord): IntentCheckResult {
    if (!this.config.enabled) {
      return {
        verdict: "approved",
        confidence: 1,
        matchedKeywords: [],
        mismatches: [],
        suggestions: [],
        reason: "Intent gate is disabled",
      };
    }

    const result = this.evaluateAction(action);

    // 记录行为历史
    this.actionHistory.push(action);

    // 记录低置信度行为
    if (result.confidence < this.config.warningThreshold) {
      this.lowConfidenceHistory.push({
        action,
        confidence: result.confidence,
        verdict: result.verdict,
        timestamp: new Date(),
      });
    }

    this.emit("checked", result, action);

    // 处理判定结果
    switch (result.verdict) {
      case "approved":
        this.emit("approved", action);
        break;
      case "rejected":
        this.emit("rejected", action, result.reason);
        break;
      case "warning":
      case "clarification":
        // 检测意图漂移
        const driftResult = this.detectDrift();
        if (driftResult.isDrifting) {
          this.driftCounter++;
          this.emit("drift_detected", action, driftResult.details);
        }
        break;
    }

    return result;
  }

  /**
   * 评估行为
   */
  private evaluateAction(action: ActionRecord): IntentCheckResult {
    const matchedKeywords: string[] = [];
    const mismatches: string[] = [];
    const suggestions: string[] = [];
    let confidence = 0;

    // 检查禁止的行为
    if (this.config.forbiddenActions.includes(action.type)) {
      return {
        verdict: "rejected",
        confidence: 1,
        matchedKeywords: [],
        mismatches: [action.type],
        suggestions: ["This action is forbidden by policy."],
        reason: `Action "${action.type}" is in the forbidden list.`,
      };
    }

    // 检查保护文件
    if (action.files) {
      for (const file of action.files) {
        for (const pattern of this.config.protectedFiles) {
          if (this.matchPattern(file, pattern)) {
            return {
              verdict: "rejected",
              confidence: 1,
              matchedKeywords: [],
              mismatches: [file],
              suggestions: [`File "${file}" is protected.`],
              reason: `Attempted to access protected file: ${file}`,
            };
          }
        }
      }
    }

    // 如果没有任务上下文，使用默认行为
    if (!this.taskContext) {
      return {
        verdict: "approved",
        confidence: 0.8,
        matchedKeywords: [],
        mismatches: [],
        suggestions: [],
        reason: "No task context set, using default approval",
      };
    }

    // 计算关键词匹配
    const actionLower = action.description.toLowerCase();
    for (const keyword of this.taskContext.keywords) {
      if (actionLower.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
      }
    }

    // 计算置信度
    const keywordMatchRatio = this.taskContext.keywords.length > 0
      ? matchedKeywords.length / this.taskContext.keywords.length
      : 0.5;

    // 检查操作是否允许
    const isOperationAllowed = this.taskContext.allowedOperations.includes(action.type) ||
      this.taskContext.allowedOperations.includes("*");

    if (!isOperationAllowed) {
      mismatches.push(`Operation "${action.type}" not in allowed list`);
      suggestions.push(`Consider if this operation is necessary for the task.`);
    }

    // 检查文件是否相关
    if (action.files && this.taskContext.relevantFiles.length > 0) {
      const relevantFileCount = action.files.filter((f) =>
        this.taskContext!.relevantFiles.some((rf) =>
          f.includes(rf) || rf.includes(f)
        )
      ).length;

      if (relevantFileCount === 0 && action.files.length > 0) {
        mismatches.push("Target files don't match task context");
        suggestions.push("Verify these files are relevant to the task.");
      }
    }

    // 综合评估
    confidence = keywordMatchRatio * 0.5 + (isOperationAllowed ? 0.3 : 0) + (mismatches.length === 0 ? 0.2 : 0);

    // 确定判定结果
    let verdict: IntentVerdict;
    if (confidence >= this.config.approvalThreshold && mismatches.length === 0) {
      verdict = "approved";
    } else if (confidence >= this.config.warningThreshold) {
      verdict = mismatches.length > 0 ? "warning" : "approved";
    } else if (confidence < this.config.lowConfidenceThreshold && this.config.autoRejectLowConfidence) {
      verdict = "rejected";
    } else {
      verdict = "clarification";
    }

    const reason = this.generateReason(verdict, confidence, matchedKeywords, mismatches);

    return {
      verdict,
      confidence,
      matchedKeywords,
      mismatches,
      suggestions,
      reason,
    };
  }

  /**
   * 匹配文件模式
   */
  private matchPattern(text: string, pattern: string): boolean {
    if (pattern.startsWith("*.")) {
      return text.endsWith(pattern.slice(1));
    }
    if (pattern.endsWith(".*")) {
      return text.startsWith(pattern.slice(0, -2));
    }
    return text === pattern;
  }

  /**
   * 检测意图漂移
   * 
   * 多维度检测算法：
   * 1. 低置信度检测 - 连续低置信度行为
   * 2. 重复行为检测 - 相同行为反复执行
   * 3. 分散行为检测 - 访问过多无关文件
   * 4. 可疑行为检测 - 包含回避性关键词
   */
  private detectDrift(): DriftDetectionResult {
    const result: DriftDetectionResult = {
      isDrifting: false,
      confidence: 0,
      details: "",
    };

    // 需要足够的行为历史
    if (this.actionHistory.length < 3) {
      return result;
    }

    const recentActions = this.actionHistory.slice(-5);
    const recentLowConfidence = this.lowConfidenceHistory.slice(-5);

    // 1. 低置信度检测：连续 3 次低置信度行为
    if (recentLowConfidence.length >= 3) {
      const avgConfidence = recentLowConfidence.reduce((sum, r) => sum + r.confidence, 0) / recentLowConfidence.length;
      if (avgConfidence < this.config.warningThreshold) {
        result.isDrifting = true;
        result.driftType = "low_confidence";
        result.confidence = 0.8;
        result.details = `连续 ${recentLowConfidence.length} 次低置信度行为，平均置信度 ${(avgConfidence * 100).toFixed(0)}%`;
        return result;
      }
    }

    // 2. 重复行为检测：相同行为类型重复 3 次以上
    const actionTypes = recentActions.map(a => a.type);
    const typeCounts = new Map<string, number>();
    for (const type of actionTypes) {
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }
    const maxRepeat = Math.max(...typeCounts.values());
    if (maxRepeat >= 3 && recentActions.length >= 3) {
      const repeatedType = [...typeCounts.entries()].find(([, count]) => count === maxRepeat)?.[0];
      result.isDrifting = true;
      result.driftType = "repetitive";
      result.confidence = 0.7;
      result.details = `行为 "${repeatedType}" 重复执行 ${maxRepeat} 次`;
      return result;
    }

    // 3. 分散行为检测：访问过多无关文件
    const allFiles = recentActions.flatMap(a => a.files ?? []);
    const uniqueFiles = new Set(allFiles);
    if (uniqueFiles.size > 10 && this.taskContext?.relevantFiles) {
      const relevantCount = allFiles.filter(f =>
        this.taskContext!.relevantFiles.some(rf => f.includes(rf) || rf.includes(f))
      ).length;
      const relevanceRatio = allFiles.length > 0 ? relevantCount / allFiles.length : 0;
      if (relevanceRatio < 0.3) {
        result.isDrifting = true;
        result.driftType = "scattered";
        result.confidence = 0.6;
        result.details = `访问 ${uniqueFiles.size} 个文件，仅 ${(relevanceRatio * 100).toFixed(0)}% 与任务相关`;
        return result;
      }
    }

    // 4. 可疑行为检测：包含回避性关键词
    const suspiciousKeywords = ["skip", "ignore", "defer", "later", "avoid", "put off"];
    const suspiciousActions = recentActions.filter(a => {
      const desc = a.description.toLowerCase();
      return suspiciousKeywords.some(kw => desc.includes(kw));
    });
    if (suspiciousActions.length >= 2) {
      result.isDrifting = true;
      result.driftType = "suspicious";
      result.confidence = 0.5;
      result.details = `检测到 ${suspiciousActions.length} 次可疑回避行为`;
      return result;
    }

    return result;
  }

  /**
   * 生成原因说明
   */
  private generateReason(
    verdict: IntentVerdict,
    confidence: number,
    matched: string[],
    mismatches: string[]
  ): string {
    const parts: string[] = [];

    switch (verdict) {
      case "approved":
        parts.push("Action aligns with task intent.");
        break;
      case "warning":
        parts.push("Action may deviate from task intent.");
        break;
      case "rejected":
        parts.push("Action is not aligned with task intent.");
        break;
      case "clarification":
        parts.push("Action intent is unclear.");
        break;
    }

    if (matched.length > 0) {
      parts.push(`Matched keywords: ${matched.join(", ")}`);
    }

    if (mismatches.length > 0) {
      parts.push(`Issues: ${mismatches.join("; ")}`);
    }

    parts.push(`Confidence: ${(confidence * 100).toFixed(0)}%`);

    return parts.join(" ");
  }

  // ============================================
  // 工具方法
  // ============================================

  /**
   * 获取行为历史
   */
  getActionHistory(): ActionRecord[] {
    return [...this.actionHistory];
  }

  /**
   * 获取低置信度行为历史
   */
  getLowConfidenceHistory(): LowConfidenceRecord[] {
    return [...this.lowConfidenceHistory];
  }

  /**
   * 获取漂移计数
   */
  getDriftCount(): number {
    return this.driftCounter;
  }

  /**
   * 执行漂移检测（公开方法）
   */
  checkDrift(): DriftDetectionResult {
    return this.detectDrift();
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.taskContext = undefined as TaskContext | undefined;
    this.actionHistory = [];
    this.lowConfidenceHistory = [];
    this.driftCounter = 0;
  }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 IntentGate
 */
export function createIntentGate(
  config?: Partial<IntentGateConfig>
): IntentGate {
  return new IntentGate(config);
}
