/**
 * 成本追踪器核心实现
 *
 * 用于追踪 AI API 调用的 Token 使用量和成本
 */

import EventEmitter from "eventemitter3";
import { v4 as uuidv4 } from "uuid";
import type { ProviderType } from "../provider/types";
import type {
  CostRecord,
  CostStats,
  CostTrackerConfig,
  CostTrackerEvents,
  ModelCostStats,
  SessionCostStats,
  TokenUsage,
} from "./types";
import { DEFAULT_COST_TRACKER_CONFIG } from "./types";
import { getModelPricing, getDefaultPricing } from "./pricing";

// ============================================================================
// CostTracker 类
// ============================================================================

/**
 * 成本追踪器
 *
 * 功能：
 * - 记录每次 API 调用的 Token 使用量
 * - 计算成本（基于模型定价）
 * - 汇总统计（按会话、按模型、总计）
 * - 支持成本阈值警告
 */
export class CostTracker extends EventEmitter<CostTrackerEvents> {
  private config: CostTrackerConfig;
  private records: CostRecord[] = [];
  private customPricing: Map<string, ReturnType<typeof getModelPricing>>;

  constructor(config: Partial<CostTrackerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_COST_TRACKER_CONFIG, ...config };
    this.customPricing = config.customPricing ?? new Map();
  }

  // ============================================================================
  // 记录管理
  // ============================================================================

  /**
   * 记录一次 API 调用
   *
   * @param sessionId 会话 ID
   * @param provider Provider 类型
   * @param model 模型名称
   * @param usage Token 使用量
   * @param metadata 可选元数据
   * @returns 成本记录
   */
  record(
    sessionId: string,
    provider: ProviderType,
    model: string,
    usage: TokenUsage,
    metadata?: Record<string, unknown>
  ): CostRecord {
    if (!this.config.enabled) {
      return this.createEmptyRecord(sessionId, provider, model, usage);
    }

    const cost = this.calculateCost(model, provider, usage);
    const record: CostRecord = {
      id: uuidv4(),
      sessionId,
      provider,
      model,
      usage: {
        ...usage,
        totalTokens: usage.totalTokens || usage.inputTokens + usage.outputTokens,
      },
      cost,
      timestamp: new Date(),
      metadata,
    };

    // 添加到记录列表
    this.records.push(record);

    // 限制最大记录数
    if (this.records.length > this.config.maxRecords) {
      this.records.shift();
    }

    // 发射事件
    this.emit("record_added", record);

    return record;
  }

  /**
   * 创建空记录（追踪禁用时）
   */
  private createEmptyRecord(
    sessionId: string,
    provider: ProviderType,
    model: string,
    usage: TokenUsage
  ): CostRecord {
    return {
      id: uuidv4(),
      sessionId,
      provider,
      model,
      usage: {
        ...usage,
        totalTokens: usage.totalTokens || usage.inputTokens + usage.outputTokens,
      },
      cost: 0,
      timestamp: new Date(),
    };
  }

  /**
   * 批量记录
   */
  recordBatch(records: Array<{
    sessionId: string;
    provider: ProviderType;
    model: string;
    usage: TokenUsage;
    metadata?: Record<string, unknown>;
  }>): CostRecord[] {
    return records.map((r) => this.record(r.sessionId, r.provider, r.model, r.usage, r.metadata));
  }

  // ============================================================================
  // 成本计算
  // ============================================================================

  /**
   * 计算 Token 使用成本
   *
   * @param model 模型名称
   * @param provider Provider 类型
   * @param usage Token 使用量
   * @returns 成本（美元）
   */
  calculateCost(
    model: string,
    provider: ProviderType,
    usage: TokenUsage
  ): number {
    // 先检查自定义定价
    const customPricing = this.customPricing.get(model);
    if (customPricing) {
      return this.computeCost(customPricing!, usage);
    }

    // 使用标准定价
    const pricing = getModelPricing(model);
    if (pricing) {
      return this.computeCost(pricing, usage);
    }

    // 使用默认定价
    const defaultPricing = getDefaultPricing(model, provider);
    return this.computeCost(defaultPricing, usage);
  }

  /**
   * 根据定价计算成本
   */
  private computeCost(
    pricing: NonNullable<ReturnType<typeof getModelPricing>>,
    usage: TokenUsage
  ): number {
    // 输入成本
    let inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPricePerMillion;

    // 缓存读取成本（如果有）
    if (usage.cachedInputTokens && pricing.cachedInputPricePerMillion) {
      // 从输入成本中减去普通输入，加上缓存输入
      inputCost -= (usage.cachedInputTokens / 1_000_000) * pricing.inputPricePerMillion;
      inputCost += (usage.cachedInputTokens / 1_000_000) * pricing.cachedInputPricePerMillion;
    }

    // 缓存写入成本（如果有）
    let cacheWriteCost = 0;
    if (usage.cacheWriteTokens && pricing.cacheWritePricePerMillion) {
      cacheWriteCost = (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePricePerMillion;
    }

    // 输出成本
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPricePerMillion;

    return inputCost + outputCost + cacheWriteCost;
  }

  // ============================================================================
  // 统计
  // ============================================================================

  /**
   * 获取统计数据
   *
   * @param filter 可选过滤器
   * @returns 统计数据
   */
  getStats(filter?: {
    sessionId?: string;
    provider?: ProviderType;
    model?: string;
    startTime?: Date;
    endTime?: Date;
  }): CostStats {
    const filteredRecords = this.filterRecords(filter);

    // 初始化统计
    const byModel = new Map<string, ModelCostStats>();
    const bySession = new Map<string, SessionCostStats>();

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedInputTokens = 0;
    let totalCacheWriteTokens = 0;
    let totalCost = 0;

    // 聚合计算
    for (const record of filteredRecords) {
      totalInputTokens += record.usage.inputTokens;
      totalOutputTokens += record.usage.outputTokens;
      totalCachedInputTokens += record.usage.cachedInputTokens ?? 0;
      totalCacheWriteTokens += record.usage.cacheWriteTokens ?? 0;
      totalCost += record.cost;

      // 按模型聚合
      const modelKey = `${record.provider}:${record.model}`;
      const modelStats = byModel.get(modelKey) ?? {
        model: record.model,
        provider: record.provider,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
        avgCostPerRequest: 0,
      };
      modelStats.requests += 1;
      modelStats.inputTokens += record.usage.inputTokens;
      modelStats.outputTokens += record.usage.outputTokens;
      modelStats.totalTokens += record.usage.totalTokens;
      modelStats.cost += record.cost;
      modelStats.avgCostPerRequest = modelStats.cost / modelStats.requests;
      byModel.set(modelKey, modelStats);

      // 按会话聚合
      const sessionStats = bySession.get(record.sessionId) ?? {
        sessionId: record.sessionId,
        requests: 0,
        totalCost: 0,
        totalTokens: 0,
        firstRequest: record.timestamp,
        lastRequest: record.timestamp,
      };
      sessionStats.requests += 1;
      sessionStats.totalCost += record.cost;
      sessionStats.totalTokens += record.usage.totalTokens;
      sessionStats.lastRequest = record.timestamp;
      bySession.set(record.sessionId, sessionStats);
    }

    // 计算时间范围
    const timestamps = filteredRecords.map((r) => r.timestamp.getTime());
    const timeRange = {
      start: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null,
      end: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null,
    };

    return {
      totalRequests: filteredRecords.length,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCachedInputTokens,
      totalCacheWriteTokens,
      totalCost,
      byModel,
      bySession,
      timeRange,
    };
  }

  /**
   * 获取当前会话统计
   */
  getSessionStats(sessionId: string): SessionCostStats | undefined {
    const stats = this.getStats({ sessionId });
    return stats.bySession.get(sessionId);
  }

  /**
   * 获取总成本
   */
  getTotalCost(): number {
    return this.records.reduce((sum, r) => sum + r.cost, 0);
  }

  /**
   * 获取总 Token 数
   */
  getTotalTokens(): { input: number; output: number; total: number } {
    const input = this.records.reduce((sum, r) => sum + r.usage.inputTokens, 0);
    const output = this.records.reduce((sum, r) => sum + r.usage.outputTokens, 0);
    return { input, output, total: input + output };
  }

  // ============================================================================
  // 过滤器
  // ============================================================================

  /**
   * 过滤记录
   */
  private filterRecords(filter?: {
    sessionId?: string;
    provider?: ProviderType;
    model?: string;
    startTime?: Date;
    endTime?: Date;
  }): CostRecord[] {
    if (!filter) {
      return [...this.records];
    }

    return this.records.filter((record) => {
      if (filter.sessionId && record.sessionId !== filter.sessionId) {
        return false;
      }
      if (filter.provider && record.provider !== filter.provider) {
        return false;
      }
      if (filter.model && record.model !== filter.model) {
        return false;
      }
      if (filter.startTime && record.timestamp < filter.startTime) {
        return false;
      }
      if (filter.endTime && record.timestamp > filter.endTime) {
        return false;
      }
      return true;
    });
  }

  // ============================================================================
  // 导出
  // ============================================================================

  /**
   * 导出为 JSON
   */
  toJSON(): string {
    return JSON.stringify({
      config: this.config,
      records: this.records,
    }, null, 2);
  }

  /**
   * 导出为 CSV
   */
  toCSV(): string {
    const headers = [
      "id",
      "sessionId",
      "provider",
      "model",
      "inputTokens",
      "outputTokens",
      "totalTokens",
      "cachedInputTokens",
      "cacheWriteTokens",
      "cost",
      "timestamp",
    ];
    
    const rows = this.records.map((r) => [
      r.id,
      r.sessionId,
      r.provider,
      r.model,
      r.usage.inputTokens,
      r.usage.outputTokens,
      r.usage.totalTokens,
      r.usage.cachedInputTokens ?? "",
      r.usage.cacheWriteTokens ?? "",
      r.cost.toFixed(6),
      r.timestamp.toISOString(),
    ]);

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  /**
   * 导出报告
   */
  exportReport(): string {
    const stats = this.getStats();
    const lines: string[] = [
      "# 成本追踪报告",
      "",
      "## 总览",
      "",
      `| 指标 | 值 |`,
      `|------|-----|`,
      `| 总请求数 | ${stats.totalRequests} |`,
      `| 总输入 Token | ${stats.totalInputTokens.toLocaleString()} |`,
      `| 总输出 Token | ${stats.totalOutputTokens.toLocaleString()} |`,
      `| 总 Token | ${stats.totalTokens.toLocaleString()} |`,
      `| 总成本 | $${stats.totalCost.toFixed(4)} |`,
      "",
      "## 按模型统计",
      "",
      "| 模型 | Provider | 请求数 | 输入 Token | 输出 Token | 成本 |",
      "|------|----------|--------|------------|------------|------|",
    ];

    for (const [, modelStats] of stats.byModel) {
      lines.push(
        `| ${modelStats.model} | ${modelStats.provider} | ${modelStats.requests} | ` +
        `${modelStats.inputTokens.toLocaleString()} | ${modelStats.outputTokens.toLocaleString()} | ` +
        `$${modelStats.cost.toFixed(4)} |`
      );
    }

    lines.push("", "## 按会话统计", "");
    
    // 只显示前 10 个会话
    const sessions = Array.from(stats.bySession.values())
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 10);

    lines.push("| 会话 ID | 请求数 | 总 Token | 成本 |");
    lines.push("|---------|--------|----------|------|");
    
    for (const session of sessions) {
      lines.push(
        `| ${session.sessionId.slice(0, 12)}... | ${session.requests} | ` +
        `${session.totalTokens.toLocaleString()} | $${session.totalCost.toFixed(4)} |`
      );
    }

    return lines.join("\n");
  }

  // ============================================================================
  // 管理
  // ============================================================================

  /**
   * 清空所有记录
   */
  clear(): void {
    this.records = [];
    this.emit("stats_reset");
  }

  /**
   * 设置自定义定价
   */
  setCustomPricing(model: string, pricing: NonNullable<ReturnType<typeof getModelPricing>>): void {
    this.customPricing.set(model, pricing);
  }

  /**
   * 获取配置
   */
  getConfig(): CostTrackerConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CostTrackerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取所有记录
   */
  getRecords(): CostRecord[] {
    return [...this.records];
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建成本追踪器
 */
export function createCostTracker(config: Partial<CostTrackerConfig> = {}): CostTracker {
  return new CostTracker(config);
}

// ============================================================================
// 单例实例
// ============================================================================

let defaultInstance: CostTracker | null = null;

/**
 * 获取默认成本追踪器实例
 */
export function getCostTracker(): CostTracker {
  if (!defaultInstance) {
    defaultInstance = new CostTracker();
  }
  return defaultInstance;
}

/**
 * 重置默认成本追踪器
 */
export function resetCostTracker(): void {
  defaultInstance = null;
}
