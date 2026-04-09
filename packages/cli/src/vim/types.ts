/**
 * Vim 模式类型定义
 */

// ============================================================================
// Vim 模式类型
// ============================================================================

/**
 * Vim 模式
 */
export type VimMode = "insert" | "normal" | "visual" | "replace";

/**
 * Vim 操作符
 */
export type VimOperator = "d" | "y" | "c" | "r" | "x" | "s";

/**
 * Vim 移动命令
 */
export type VimMotion =
  | "h"     // 左
  | "j"     // 下
  | "k"     // 上
  | "l"     // 右
  | "w"     // 下一个词
  | "W"     // 下一个词（空格分隔）
  | "b"     // 上一个词
  | "B"     // 上一个词（空格分隔）
  | "e"     // 词尾
  | "E"     // 词尾（空格分隔）
  | "0"     // 行首
  | "^"     // 非空行首
  | "$"     // 行尾
  | "gg"    // 文件首
  | "G"     // 文件尾
  | "fx"    // 查找字符 x
  | "Fx"    // 反向查找字符 x
  | "tx"    // 查找字符 x 前
  | "Tx";   // 反向查找字符 x 前

/**
 * Vim 动作类型
 */
export type VimActionType =
  | "motion"      // 移动
  | "operator"    // 操作符
  | "insert"      // 插入模式
  | "replace"     // 替换模式
  | "delete"      // 删除
  | "yank"        // 复制
  | "paste"       // 粘贴
  | "undo"        // 撤销
  | "redo"        // 重做
  | "search"      // 搜索
  | "command";    // 命令

/**
 * Vim 动作
 */
export interface VimAction {
  type: VimActionType;
  key: string;
  description: string;
  requiresMotion?: boolean;
}

/**
 * Vim 状态
 */
export interface VimState {
  /** 当前模式 */
  mode: VimMode;
  /** 光标位置 */
  cursor: number;
  /** 选择范围 */
  selection?: {
    start: number;
    end: number;
  };
  /** 寄存器内容 */
  register: string;
  /** 待处理的操作符 */
  pendingOperator?: VimOperator;
  /** 待处理的计数 */
  count?: number;
  /** 最后搜索的字符 */
  lastSearchChar?: string;
  /** 最后搜索方向 */
  lastSearchDirection?: "forward" | "backward";
}

/**
 * Vim 配置
 */
export interface VimConfig {
  /** 是否启用 Vim 模式 */
  enabled: boolean;
  /** 默认模式 */
  defaultMode: VimMode;
  /** 是否显示模式指示器 */
  showModeIndicator: boolean;
}

/**
 * 默认 Vim 配置
 */
export const DEFAULT_VIM_CONFIG: VimConfig = {
  enabled: false,
  defaultMode: "insert",
  showModeIndicator: true,
};

/**
 * Vim 命令定义
 */
export interface VimCommand {
  /** 命令键 */
  key: string;
  /** 命令描述 */
  description: string;
  /** 可用模式 */
  modes: VimMode[];
  /** 执行函数 */
  execute: (state: VimState, text: string) => VimState;
}

/**
 * Vim 键位映射
 */
export interface VimKeyMapping {
  /** 模式 */
  mode: VimMode;
  /** 键 */
  key: string;
  /** 动作 */
  action: VimAction;
}
