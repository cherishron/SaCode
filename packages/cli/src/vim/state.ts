/**
 * Vim 模式状态机
 *
 * 管理 Vim 模式的状态转换和基本操作
 */

import type { VimMode, VimState, VimOperator } from "./types.js";

// ============================================================================
// 初始状态
// ============================================================================

/**
 * 创建初始 Vim 状态
 */
export function createInitialState(mode: VimMode = "insert"): VimState {
  return {
    mode,
    cursor: 0,
    register: "",
  };
}

// ============================================================================
// 模式转换
// ============================================================================

/**
 * 模式转换映射
 */
const MODE_TRANSITIONS: Record<string, VimMode> = {
  // Insert -> Normal
  "<Escape>": "normal",
  "<C-[>": "normal",

  // Normal -> Insert
  "i": "insert",   // 光标前插入
  "I": "insert",   // 行首插入
  "a": "insert",   // 光标后插入
  "A": "insert",   // 行尾插入
  "o": "insert",   // 下方新行
  "O": "insert",   // 上方新行
  "s": "insert",   // 删除字符并插入
  "S": "insert",   // 删除行并插入
  "c": "insert",   // 修改（需要 motion）
  "C": "insert",   // 修改到行尾

  // Normal -> Visual
  "v": "visual",   // 字符选择
  "V": "visual",   // 行选择

  // Normal -> Replace
  "R": "replace",
};

/**
 * 切换模式
 */
export function switchMode(state: VimState, key: string): VimState {
  const newMode = MODE_TRANSITIONS[key];

  if (!newMode) {
    return state;
  }

  return {
    ...state,
    mode: newMode,
    pendingOperator: undefined,
    count: undefined,
  };
}

/**
 * 切换到指定模式
 */
export function setMode(state: VimState, mode: VimMode): VimState {
  return {
    ...state,
    mode,
    pendingOperator: undefined,
    count: undefined,
  };
}

// ============================================================================
// 光标操作
// ============================================================================

/**
 * 移动光标
 */
export function moveCursor(
  state: VimState,
  delta: number,
  text: string
): VimState {
  const newCursor = Math.max(0, Math.min(text.length, state.cursor + delta));

  return {
    ...state,
    cursor: newCursor,
  };
}

/**
 * 设置光标位置
 */
export function setCursor(state: VimState, position: number, text: string): VimState {
  const newCursor = Math.max(0, Math.min(text.length, position));

  return {
    ...state,
    cursor: newCursor,
  };
}

// ============================================================================
// 操作符处理
// ============================================================================

/**
 * 设置待处理操作符
 */
export function setPendingOperator(
  state: VimState,
  operator: VimOperator
): VimState {
  return {
    ...state,
    pendingOperator: operator,
  };
}

/**
 * 清除待处理操作符
 */
export function clearPendingOperator(state: VimState): VimState {
  return {
    ...state,
    pendingOperator: undefined,
    count: undefined,
  };
}

// ============================================================================
// 计数处理
// ============================================================================

/**
 * 累积计数
 */
export function accumulateCount(state: VimState, digit: number): VimState {
  const currentCount = state.count ?? 0;
  const newCount = currentCount * 10 + digit;

  return {
    ...state,
    count: newCount,
  };
}

// ============================================================================
// 选择操作
// ============================================================================

/**
 * 开始选择
 */
export function startSelection(state: VimState): VimState {
  return {
    ...state,
    selection: {
      start: state.cursor,
      end: state.cursor,
    },
  };
}

/**
 * 更新选择范围
 */
export function updateSelection(state: VimState): VimState {
  if (!state.selection) {
    return state;
  }

  return {
    ...state,
    selection: {
      ...state.selection,
      end: state.cursor,
    },
  };
}

/**
 * 结束选择
 */
export function endSelection(state: VimState): VimState {
  return {
    ...state,
    selection: undefined,
  };
}

// ============================================================================
// 寄存器操作
// ============================================================================

/**
 * 复制到寄存器
 */
export function yankToRegister(state: VimState, text: string): VimState {
  return {
    ...state,
    register: text,
  };
}

/**
 * 从寄存器粘贴
 */
export function pasteFromRegister(state: VimState): string {
  return state.register;
}

// ============================================================================
// 状态重置
// ============================================================================

/**
 * 重置状态
 */
export function resetState(mode: VimMode = "insert"): VimState {
  return createInitialState(mode);
}

// ============================================================================
// 导出
// ============================================================================

export default {
  createInitialState,
  switchMode,
  setMode,
  moveCursor,
  setCursor,
  setPendingOperator,
  clearPendingOperator,
  accumulateCount,
  startSelection,
  updateSelection,
  endSelection,
  yankToRegister,
  pasteFromRegister,
  resetState,
};
