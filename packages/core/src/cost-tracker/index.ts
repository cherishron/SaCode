/**
 * 成本追踪模块
 *
 * 用于追踪 AI API 调用的 Token 使用量和成本
 *
 * @module @sacode/core/cost-tracker
 */

// Types
export type {
  TokenUsage,
  CostRecord,
  ModelPricing,
  CostStats,
  ModelCostStats,
  SessionCostStats,
  CostTrackerConfig,
  CostTrackerEvents,
} from "./types";

export {
  DEFAULT_COST_TRACKER_CONFIG,
  CostTrackerError,
  PricingNotFoundError,
} from "./types";

// Pricing
export {
  OPENAI_PRICING,
  ANTHROPIC_PRICING,
  DEEPSEEK_PRICING,
  MOONSHOT_PRICING,
  ZHIPU_PRICING,
  MODEL_PRICING_MAP,
  MODEL_ALIASES,
  getModelPricing,
  getDefaultPricing,
} from "./pricing";

// Tracker
export {
  CostTracker,
  createCostTracker,
  getCostTracker,
  resetCostTracker,
} from "./tracker";
