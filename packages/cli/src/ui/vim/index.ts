/**
 * Vim 模式核心状态管理
 */

export type VimMode = "normal" | "insert" | "visual" | "replace";

export interface VimState {
  mode: VimMode;
  cursor: number;
  count?: number;
  pendingOperator?: string;
  register?: string;
}

/**
 * 创建初始 Vim 状态
 */
export function createInitialState(mode: VimMode = "insert"): VimState {
  return {
    mode,
    cursor: 0,
  };
}

/**
 * 根据输入切换模式
 */
export function switchMode(state: VimState, input: string): VimState {
  switch (input) {
    case "i":
      return { ...state, mode: "insert" };
    case "I":
      return { ...state, mode: "insert", cursor: 0 };
    case "a":
      return { ...state, mode: "insert", cursor: state.cursor + 1 };
    case "A":
      return { ...state, mode: "insert" };
    case "v":
    case "V":
      return { ...state, mode: "visual" };
    case "R":
      return { ...state, mode: "replace" };
    case "o":
    case "O":
    case "s":
    case "S":
    case "c":
    case "C":
      return { ...state, mode: "insert" };
    default:
      return state;
  }
}

/**
 * 设置模式
 */
export function setMode(state: VimState, mode: VimMode): VimState {
  return { ...state, mode };
}

/**
 * 移动光标
 */
export function moveCursor(state: VimState, offset: number): VimState {
  return { ...state, cursor: Math.max(0, state.cursor + offset) };
}

/**
 * 设置待处理操作符
 */
export function setPendingOperator(state: VimState, operator: "d" | "y" | "c"): VimState {
  return { ...state, pendingOperator: operator };
}

/**
 * 清除待处理操作符
 */
export function clearPendingOperator(state: VimState): VimState {
  const { pendingOperator: _, count: __, ...rest } = state;
  return rest;
}

/**
 * 累加计数
 */
export function accumulateCount(state: VimState, digit: number): VimState {
  const current = state.count ?? 0;
  return { ...state, count: current * 10 + digit };
}
