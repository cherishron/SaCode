/**
 * 扩展配置模块 — 统一导出
 */
export { ExtendedConfigManager, getExtendedConfigManager } from "./manager.js";
export {
  type AgenticConfig,
  type CodingPlanPreferences,
  type UIConfig,
  type ExtendedCLIConfig,
  DEFAULT_EXTENDED_CONFIG,
  CONFIG_KEY_MAP,
} from "./types.js";
