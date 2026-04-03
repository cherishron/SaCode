/**
 * SaCode CLI 主题系统
 *
 * 统一管理颜色、边框、图标等视觉元素
 * 
 * 新的主题系统提供：
 * - 语义化颜色 Token
 * - 多主题支持
 * - 终端背景自适应
 * - 代码高亮集成
 */

// 从新主题系统导出所有内容
export * from "./theme/index.js";

// 兼容旧 API
import { getColors, getThemeManager, toInkColor } from "./theme/index.js";

/**
 * 获取当前主题的颜色（兼容旧 API）
 * @deprecated 请使用 getColors() 或直接从 theme/index.js 导入
 */
export const colors = {
  get primary() {
    return toInkColor(getColors().text.accent);
  },
  get secondary() {
    return toInkColor(getColors().text.response);
  },
  get accent() {
    return toInkColor(getColors().text.accent);
  },
  get success() {
    return toInkColor(getColors().status.success);
  },
  get error() {
    return toInkColor(getColors().status.error);
  },
  get warning() {
    return toInkColor(getColors().status.warning);
  },
  get info() {
    return toInkColor(getColors().status.info);
  },
  get text() {
    return toInkColor(getColors().text.primary);
  },
  get textMuted() {
    return toInkColor(getColors().text.secondary);
  },
  get textDim() {
    return toInkColor(getColors().text.comment);
  },
  get user() {
    return toInkColor(getColors().text.user);
  },
  get assistant() {
    return toInkColor(getColors().text.response);
  },
  get tool() {
    return toInkColor(getColors().ui.symbol);
  },
  get system() {
    return toInkColor(getColors().text.system);
  },
};

/**
 * 边框样式（兼容旧 API）
 */
export const borders = {
  default: "round" as const,
  accent: "double" as const,
  minimal: "single" as const,
  none: undefined,
};

/**
 * 工具图标映射
 */
export const toolIcons: Record<string, string> = {
  // 文件操作
  read_file: "📄",
  write_file: "📝",
  replace: "✏️",
  edit_file: "✏️",
  delete_file: "🗑️",
  list_directory: "📁",
  glob: "🔍",
  grep_tool: "🔍",

  // Web 操作
  web_search: "🌐",
  web_fetch: "🌐",
  http_request: "🔗",

  // 系统操作
  run_shell_command: "💻",

  // AI 功能
  think: "💭",
  plan: "📋",

  // 时间
  get_current_time: "🕐",

  // 内存/存储
  save_memory: "💾",

  // 任务管理
  todo_read: "📋",
  todo_write: "✅",

  // 用户交互
  ask_user_question: "❓",

  // 多媒体
  image_read: "🖼️",

  // Agent
  task: "🤖",

  // 默认
  default: "🔧",
};

/**
 * 状态图标
 */
export const statusIcons = {
  pending: "○",
  running: "◐",
  success: "✓",
  error: "✗",
} as const;

/**
 * 间距配置
 */
export const spacing = {
  xs: 0,
  sm: 1,
  md: 2,
  lg: 3,
  xl: 4,
} as const;

/**
 * 分隔线样式
 */
export const separators = {
  horizontal: "─",
  horizontalDouble: "═",
  horizontalBold: "━",
  vertical: "│",
  cornerTopLeft: "┌",
  cornerTopRight: "┐",
  cornerBottomLeft: "└",
  cornerBottomRight: "┘",
} as const;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取工具图标
 */
export function getToolIcon(toolName: string): string {
  return toolIcons[toolName] ?? toolIcons.default;
}

/**
 * 获取状态颜色
 */
export function getStatusColor(
  status: "pending" | "running" | "success" | "error"
): string {
  const statusColorMap: Record<string, string> = {
    pending: toInkColor(getColors().status.pending),
    running: toInkColor(getColors().status.running),
    success: toInkColor(getColors().status.success),
    error: toInkColor(getColors().status.error),
  };
  return statusColorMap[status] ?? statusColorMap.pending;
}

/**
 * 获取状态图标
 */
export function getStatusIcon(status: "pending" | "running" | "success" | "error"): string {
  return statusIcons[status];
}

/**
 * 创建分隔线
 */
export function createSeparator(width: number, char = separators.horizontal): string {
  return char.repeat(width);
}

// ============================================================================
// 主题对象（兼容旧 API）
// ============================================================================

export const theme = {
  colors,
  borders,
  toolIcons,
  statusIcons,
  spacing,
  separators,
  getToolIcon,
  getStatusColor,
  getStatusIcon,
  createSeparator,
} as const;

export default theme;