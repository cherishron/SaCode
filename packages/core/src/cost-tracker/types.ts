/**
 * 成本追踪模块类型定义
 *
 * 用于追踪 AI API 调用的 Token 使用量和成本
 */

import type { ProviderType } from "../provider/types";

// ============================================================================
// Token 使用量
// ============================================================================

/**
 * 单次请求的 Token 使用量
 */
export interface TokenUsage {
  /** 输入 Token 数量 */
  inputTokens: number;
  /** 输出 Token 数量 */
  outputTokens: number;
  /** 总 Token 数量 */
  totalTokens: number;
  /** 缓存读取的 Token（如果有 Prompt Caching） */
  cachedInputTokens?: number | undefined;
  /** 缓存写入的 Token（如果有 Prompt Caching） */
  cacheWriteTokens?: number | undefined;
}

/**
 * 成本记录
 */
export interface CostRecord {
  /** 记录 ID */
  id: string;
  /** 会话 ID */
  sessionId: string;
  /** Provider 类型 */
  provider: ProviderType;
  /** 模型名称 */
  model: string;
  /** Token 使用量 */
  usage: TokenUsage;
  /** 计算的成本（美元） */
  cost: number;
  /** 请求时间 */
  timestamp: Date;
  /** 请求 ID（可选） */
  requestId?: string | undefined;
  /** 元数据（可选） */
  metadata?: Record<string, unknown> | undefined;
}

// ============================================================================
// 定价配置
// ============================================================================

/**
 * 模型定价配置
 */
export interface ModelPricing {
  /** 模型标识 */
  modelId: string;
  /** 模型显示名称 */
  displayName: string;
  /** Provider 类型 */
  provider: ProviderType;
  /** 输入 Token 价格（美元/百万 Token） */
  inputPricePerMillion: number;
  /** 输出 Token 价格（美元/百万 Token） */
  outputPricePerMillion: number;
  /** 缓存输入价格（美元/百万 Token，如果有 Prompt Caching） */
  cachedInputPricePerMillion?: number | undefined;
  /** 缓存写入价格（美元/百万 Token） */
  cacheWritePricePerMillion?: number | undefined;
  /** 上下文窗口大小 */
  contextWindow: number;
  /** 最大输出 Token */
  maxOutputTokens?: number | undefined;
}

/**
 * 成本统计
 */
export interface CostStats {
  /** 总请求数 */
  totalRequests: number;
  /** 总输入 Token */
  totalInputTokens: number;
  /** 总输出 Token */
  totalOutputTokens: number;
  /** 总 Token */
  totalTokens: number;
  /** 总缓存读取 Token */
  totalCachedInputTokens: number;
  /** 总缓存写入 Token */
  totalCacheWriteTokens: number;
  /** 总成本（美元） */
  totalCost: number;
  /** 按模型分组的统计 */
  byModel: Map<string, ModelCostStats>;
  /** 按会话分组的统计 */
  bySession: Map<string, SessionCostStats>;
  /** 统计时间范围 */
  timeRange: {
    start: Date | null;
    end: Date | null;
  };
}

/**
 * 按模型的成本统计
 */
export interface ModelCostStats {
  /** 模型名称 */
  model: string;
  /** Provider 类型 */
  provider: ProviderType;
  /** 请求数 */
  requests: number;
  /** 输入 Token */
  inputTokens: number;
  /** 输出 Token */
  outputTokens: number;
  /** 总 Token */
  totalTokens: number;
  /** 成本 */
  cost: number;
  /** 平均每次请求成本 */
  avgCostPerRequest: number;
}

/**
 * 按会话的成本统计
 */
export interface SessionCostStats {
  /** 会话 ID */
  sessionId: string;
  /** 请求数 */
  requests: number;
  /** 总成本 */
  totalCost: number;
  /** 总 Token */
  totalTokens: number;
  /** 首次请求时间 */
  firstRequest: Date;
  /** 最后请求时间 */
  lastRequest: Date;
}

// ============================================================================
// 配置
// ============================================================================

/**
 * 成本追踪器配置
 */
export interface CostTrackerConfig {
  /** 是否启用成本追踪 */
  enabled: boolean;
  /** 是否持久化记录 */
  persistRecords: boolean;
  /** 最大记录数（内存中保留） */
  maxRecords: number;
  /** 默认货币 */
  currency: "USD" | "CNY";
  /** 自定义定价配置 */
  customPricing?: Map<string, ModelPricing> | undefined;
}

/**
 * 默认成本追踪器配置
 */
export const DEFAULT_COST_TRACKER_CONFIG: CostTrackerConfig = {
  enabled: true,
  persistRecords: false,
  maxRecords: 10000,
  currency: "USD",
};

// ============================================================================
// 事件
// ============================================================================

/**
 * 成本追踪事件
 */
export interface CostTrackerEvents {
  /** 记录添加 */
  record_added: (record: CostRecord) => void;
  /** 成本阈值警告 */
  cost_warning: (stats: CostStats, threshold: number) => void;
  /** 统计重置 */
  stats_reset: () => void;
}

// ============================================================================
// 错误
// ============================================================================

/**
 * 成本追踪错误
 */
export class CostTrackerError extends Error {
  override name = "CostTrackerError";
  public readonly code: string;

  constructor(code: string, message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.code = code;
  }
}

/**
 * 模型定价未找到错误
 */
export class PricingNotFoundError extends CostTrackerError {
  override name = "PricingNotFoundError";

  constructor(model: string) {
    super("PRICING_NOT_FOUND", `Pricing not found for model: ${model}`);
  }
}
