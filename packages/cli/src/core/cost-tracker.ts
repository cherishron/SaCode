/**
 * 成本追踪器 - Token 使用量和成本统计
 * 参考 Claude Code cost-tracker.ts 设计
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 成本条目
 */
export interface CostEntry {
  /** 时间戳 */
  timestamp: Date;
  /** 输入 Token 数 */
  inputTokens: number;
  /** 输出 Token 数 */
  outputTokens: number;
  /** 模型名称 */
  model: string;
  /** 估算成本（美元） */
  estimatedCost: number;
}

/**
 * 成本摘要
 */
export interface CostSummary {
  /** 总输入 Token */
  totalInputTokens: number;
  /** 总输出 Token */
  totalOutputTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 总成本（美元） */
  totalCost: number;
  /** 请求次数 */
  requestCount: number;
  /** 平均每次请求 Token */
  avgTokensPerRequest: number;
}

/**
 * 模型定价
 */
export interface ModelPricing {
  /** 输入价格（每百万 Token） */
  inputPerMillion: number;
  /** 输出价格（每百万 Token） */
  outputPerMillion: number;
}

/**
 * 成本配置
 */
export interface CostConfig {
  /** 成本阈值警告（美元） */
  costThreshold?: number;
  /** Token 阈值警告 */
  tokenThreshold?: number;
  /** 模型定价表 */
  pricing?: Record<string, ModelPricing>;
  /** 阈值回调 */
  onThreshold?: (summary: CostSummary) => void;
}

// ============================================================================
// 默认定价
// ============================================================================

/**
 * 默认模型定价（美元/百万 Token）
 */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4-turbo": { inputPerMillion: 10, outputPerMillion: 30 },
  "claude-3-5-sonnet": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-3-opus": { inputPerMillion: 15, outputPerMillion: 75 },
  "deepseek-chat": { inputPerMillion: 0.14, outputPerMillion: 0.28 },
  "moonshot-v1-8k": { inputPerMillion: 0.5, outputPerMillion: 1 },
  "glm-4": { inputPerMillion: 0.5, outputPerMillion: 1 },
};

// ============================================================================
// 成本追踪器
// ============================================================================

/**
 * 成本追踪器
 *
 * 追踪 Token 使用量和估算成本：
 * - 记录每次请求的 Token 使用
 * - 根据模型定价估算成本
 * - 支持阈值警告
 * - 提供使用统计
 */
export class CostTracker {
  private entries: CostEntry[] = [];
  private pricing: Record<string, ModelPricing>;
  private costThreshold: number;
  private tokenThreshold: number;
  private onThreshold?: ((summary: CostSummary) => void) | undefined;
  private thresholdTriggered = false;

  constructor(config: CostConfig = {}) {
    this.pricing = config.pricing ?? DEFAULT_PRICING;
    this.costThreshold = config.costThreshold ?? 10;
    this.tokenThreshold = config.tokenThreshold ?? 1000000;
    this.onThreshold = config.onThreshold;
  }

  /**
   * 记录一次请求的使用量
   */
  record(inputTokens: number, outputTokens: number, model: string): CostEntry {
    const pricing = this.pricing[model] ?? { inputPerMillion: 1, outputPerMillion: 2 };

    const estimatedCost =
      (inputTokens / 1_000_000) * pricing.inputPerMillion +
      (outputTokens / 1_000_000) * pricing.outputPerMillion;

    const entry: CostEntry = {
      timestamp: new Date(),
      inputTokens,
      outputTokens,
      model,
      estimatedCost,
    };

    this.entries.push(entry);

    // 检查阈值
    this.checkThresholds();

    return entry;
  }

  /**
   * 获取成本摘要
   */
  getSummary(): CostSummary {
    const totalInputTokens = this.entries.reduce((sum, e) => sum + e.inputTokens, 0);
    const totalOutputTokens = this.entries.reduce((sum, e) => sum + e.outputTokens, 0);
    const totalTokens = totalInputTokens + totalOutputTokens;
    const totalCost = this.entries.reduce((sum, e) => sum + e.estimatedCost, 0);
    const requestCount = this.entries.length;

    return {
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalCost,
      requestCount,
      avgTokensPerRequest: requestCount > 0 ? Math.round(totalTokens / requestCount) : 0,
    };
  }

  /**
   * 获取最近的条目
   */
  getRecentEntries(count = 10): CostEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * 获取按模型分组的统计
   */
  getModelBreakdown(): Record<string, CostSummary> {
    const breakdown: Record<string, CostEntry[]> = {};

    for (const entry of this.entries) {
      const model = entry.model;
      if (!breakdown[model]) {
        breakdown[model] = [];
      }
      breakdown[model]!.push(entry);
    }

    const result: Record<string, CostSummary> = {};

    for (const [model, entries] of Object.entries(breakdown)) {
      const totalInputTokens = entries.reduce((sum, e) => sum + e.inputTokens, 0);
      const totalOutputTokens = entries.reduce((sum, e) => sum + e.outputTokens, 0);
      const totalTokens = totalInputTokens + totalOutputTokens;
      const totalCost = entries.reduce((sum, e) => sum + e.estimatedCost, 0);

      result[model] = {
        totalInputTokens,
        totalOutputTokens,
        totalTokens,
        totalCost,
        requestCount: entries.length,
        avgTokensPerRequest: entries.length > 0 ? Math.round(totalTokens / entries.length) : 0,
      };
    }

    return result;
  }

  /**
   * 重置所有记录
   */
  reset(): void {
    this.entries = [];
    this.thresholdTriggered = false;
  }

  /**
   * 设置成本阈值
   */
  setCostThreshold(threshold: number): void {
    this.costThreshold = threshold;
  }

  /**
   * 获取条目数量
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * 检查阈值
   */
  private checkThresholds(): void {
    if (this.thresholdTriggered) return;

    const summary = this.getSummary();

    if (summary.totalCost >= this.costThreshold || summary.totalTokens >= this.tokenThreshold) {
      this.thresholdTriggered = true;
      this.onThreshold?.(summary);
      console.warn(
        `⚠️  成本阈值警告! 总成本: $${summary.totalCost.toFixed(4)}, 总 Token: ${summary.totalTokens.toLocaleString()}`
      );
    }
  }

  /**
   * 格式化成本摘要为字符串
   */
  formatSummary(): string {
    const summary = this.getSummary();
    const lines = [
      "## 成本统计",
      `总输入 Token: ${summary.totalInputTokens.toLocaleString()}`,
      `总输出 Token: ${summary.totalOutputTokens.toLocaleString()}`,
      `总 Token 数: ${summary.totalTokens.toLocaleString()}`,
      `估算成本: $${summary.totalCost.toFixed(4)}`,
      `请求次数: ${summary.requestCount}`,
      `平均每次请求: ${summary.avgTokensPerRequest.toLocaleString()} tokens`,
    ];

    // 按模型分组
    const breakdown = this.getModelBreakdown();
    if (Object.keys(breakdown).length > 1) {
      lines.push("\n### 按模型分组");
      for (const [model, stats] of Object.entries(breakdown)) {
        lines.push(
          `- **${model}**: ${stats.totalTokens.toLocaleString()} tokens ($${stats.totalCost.toFixed(4)})`
        );
      }
    }

    return lines.join("\n");
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建成本追踪器
 */
export function createCostTracker(config?: CostConfig): CostTracker {
  return new CostTracker(config);
}

// ============================================================================
// 导出
// ============================================================================

export default CostTracker;
