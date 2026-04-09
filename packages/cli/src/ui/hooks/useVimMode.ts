/**
 * useVimMode Hook - Vim 模式管理
 *
 * 管理 Vim 模式的状态和键盘输入处理
 */

import { useState, useCallback, useMemo } from "react";
import { useInput } from "ink";
import {
  createInitialState,
  switchMode,
  setMode,
  setPendingOperator,
  clearPendingOperator,
  accumulateCount,
  type VimMode,
  type VimState,
} from "../vim/index.js";
import { executeMotion, MOTIONS } from "../vim/motions.js";

// ============================================================================
// 类型定义
// ============================================================================

export interface UseVimModeOptions {
  /** 是否启用 Vim 模式 */
  enabled?: boolean;
  /** 初始模式 */
  initialMode?: VimMode;
  /** 文本内容 */
  text?: string;
  /** 模式变化回调 */
  onModeChange?: (mode: VimMode) => void;
  /** 光标变化回调 */
  onCursorChange?: (cursor: number) => void;
  /** 文本变化回调 */
  onTextChange?: (text: string) => void;
}

export interface UseVimModeResult {
  /** 当前状态 */
  state: VimState;
  /** 当前模式 */
  mode: VimMode;
  /** 光标位置 */
  cursor: number;
  /** 切换模式 */
  setMode: (mode: VimMode) => void;
  /** 重置状态 */
  reset: () => void;
  /** 是否启用 */
  isEnabled: boolean;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useVimMode(options: UseVimModeOptions = {}): UseVimModeResult {
  const {
    enabled = false,
    initialMode = "insert",
    text = "",
    onModeChange,
    onCursorChange,
    onTextChange,
  } = options;

  // 状态
  const [state, setState] = useState<VimState>(() =>
    createInitialState(initialMode)
  );

  // 处理模式切换
  const handleSetMode = useCallback(
    (newMode: VimMode) => {
      setState((prev) => setMode(prev, newMode));
      onModeChange?.(newMode);
    },
    [onModeChange]
  );

  // 重置状态
  const reset = useCallback(() => {
    setState(createInitialState(initialMode));
    onModeChange?.(initialMode);
  }, [initialMode, onModeChange]);

  // 处理 Normal 模式的输入
  useInput(
    (input, key) => {
      if (!enabled || state.mode !== "normal") return;

      // 数字计数
      if (/^[1-9]$/.test(input)) {
        setState((prev) => accumulateCount(prev, parseInt(input, 10)));
        return;
      }

      // Escape - 清除待处理状态
      if (key.escape) {
        setState((prev) => clearPendingOperator(prev));
        return;
      }

      // 模式切换
      if (["i", "I", "a", "A", "o", "O", "s", "S", "c", "C", "v", "V", "R"].includes(input)) {
        const newState = switchMode(state, input);
        setState(newState);
        onModeChange?.(newState.mode);
        return;
      }

      // 移动命令
      if (MOTIONS[input] || input === "g") {
        setState((prev: VimState) => {
          const count = prev.count ?? 1;
          const newCursor = executeMotion(input, text, prev.cursor, count);
          onCursorChange?.(newCursor);
          const { count: _, ...rest } = prev;
          return {
            ...rest,
            cursor: newCursor,
          };
        });
        return;
      }

      // gg 命令（需要两次 g）
      if (input === "g" && state.pendingOperator === "g") {
        const newCursor = executeMotion("gg", text, state.cursor);
        setState((prev: VimState) => {
          const { pendingOperator: _, count: __, ...rest } = prev;
          return {
            ...rest,
            cursor: newCursor,
          };
        });
        onCursorChange?.(newCursor);
        return;
      }

      // 操作符
      if (["d", "y", "c"].includes(input)) {
        setState((prev) => setPendingOperator(prev, input as "d" | "y" | "c"));
        return;
      }

      // x - 删除当前字符
      if (input === "x") {
        if (text.length > 0 && state.cursor < text.length) {
          const newText = text.slice(0, state.cursor) + text.slice(state.cursor + 1);
          onTextChange?.(newText);
        }
        return;
      }

      // p - 粘贴
      if (input === "p" && state.register) {
        const newText = text.slice(0, state.cursor) + state.register + text.slice(state.cursor);
        onTextChange?.(newText);
        onCursorChange?.(state.cursor + state.register.length);
        return;
      }

      // u - 撤销（需要外部支持）
      // Ctrl+R - 重做（需要外部支持）
    },
    { isActive: enabled && state.mode === "normal" }
  );

  // Insert 模式处理
  useInput(
    (input, key) => {
      if (!enabled || state.mode !== "insert") return;

      // Escape 或 Ctrl+[ - 返回 Normal 模式
      if (key.escape || (input === "[" && key.ctrl)) {
        const newState = setMode(state, "normal");
        setState(newState);
        onModeChange?.("normal");
        return;
      }
    },
    { isActive: enabled && state.mode === "insert" }
  );

  return useMemo(
    () => ({
      state,
      mode: state.mode,
      cursor: state.cursor,
      setMode: handleSetMode,
      reset,
      isEnabled: enabled,
    }),
    [state, handleSetMode, reset, enabled]
  );
}

export default useVimMode;
