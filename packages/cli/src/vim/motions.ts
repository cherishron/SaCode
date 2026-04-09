/**
 * Vim 移动命令
 *
 * 纯函数实现，易于测试
 */

import type { VimState } from "./types.js";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 移动结果
 */
export interface MotionResult {
  cursor: number;
  motionName: string;
}

/**
 * 移动函数类型
 */
export type MotionFunction = (text: string, cursor: number, count?: number) => number;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取当前行
 */
function getCurrentLine(text: string, cursor: number): { line: string; lineStart: number; lineEnd: number } {
  const lines = text.split("\n");
  let currentPos = 0;

  for (const line of lines) {
    const lineEnd = currentPos + line.length;

    if (cursor <= lineEnd) {
      return { line, lineStart: currentPos, lineEnd };
    }

    currentPos = lineEnd + 1; // +1 for newline
  }

  // 返回最后一行
  const lastLine = lines[lines.length - 1] ?? "";
  return {
    line: lastLine,
    lineStart: text.length - lastLine.length,
    lineEnd: text.length,
  };
}

/**
 * 检查是否是单词字符
 */
function isWordChar(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char);
}

// ============================================================================
// 基本移动
// ============================================================================

/**
 * 左移 (h)
 */
export const moveLeft: MotionFunction = (text, cursor, count = 1) => {
  return Math.max(0, cursor - count);
};

/**
 * 右移
 */
export const moveRight: MotionFunction = (text, cursor, count = 1) => {
  return Math.min(text.length, cursor + count);
};

/**
 * 上移 - 在输入框中通常等同于 Home
 */
export const moveUp: MotionFunction = (text, cursor) => {
  const { lineStart } = getCurrentLine(text, cursor);
  return lineStart;
};

/**
 * 下移 - 在输入框中通常等同于 End
 */
export const moveDown: MotionFunction = (text, cursor) => {
  const { lineEnd } = getCurrentLine(text, cursor);
  return lineEnd;
};

// ============================================================================
// 词移动
// ============================================================================

/**
 * 下一个词首
 */
export const nextWord: MotionFunction = (text, cursor, count = 1) => {
  let pos = cursor;

  for (let i = 0; i < count; i++) {
    // 跳过当前词
    while (pos < text.length && isWordChar(text[pos]!)) {
      pos++;
    }

    // 跳过空白
    while (pos < text.length && !isWordChar(text[pos]!) && text[pos] !== "\n") {
      pos++;
    }

    // 跳过换行后的空白
    while (pos < text.length && text[pos] === " ") {
      pos++;
    }
  }

  return Math.min(pos, text.length);
};

/**
 * 上一个词首
 */
export const prevWord: MotionFunction = (text, cursor, count = 1) => {
  let pos = cursor;

  for (let i = 0; i < count; i++) {
    // 后退一个字符（如果不在词首）
    if (pos > 0 && isWordChar(text[pos - 1]!)) {
      pos--;
    }

    // 跳过当前词
    while (pos > 0 && isWordChar(text[pos - 1]!)) {
      pos--;
    }

    // 跳过空白
    while (pos > 0 && !isWordChar(text[pos - 1]!) && text[pos - 1] !== "\n") {
      pos--;
    }
  }

  return Math.max(0, pos);
};

/**
 * 词尾
 */
export const endWord: MotionFunction = (text, cursor, count = 1) => {
  let pos = cursor;

  for (let i = 0; i < count; i++) {
    // 前进一个字符
    if (pos < text.length) {
      pos++;
    }

    // 跳过空白
    while (pos < text.length && !isWordChar(text[pos]!) && text[pos] !== "\n") {
      pos++;
    }

    // 到词尾
    while (pos < text.length && isWordChar(text[pos]!)) {
      pos++;
    }

    // 回退一个字符
    if (pos > 0) {
      pos--;
    }
  }

  return Math.min(pos, text.length - 1);
};

// ============================================================================
// 行移动
// ============================================================================

/**
 * 行首 (0)
 */
export const lineStart: MotionFunction = (text, cursor) => {
  const { lineStart } = getCurrentLine(text, cursor);
  return lineStart;
};

/**
 * 非空行首 (^)
 */
export const lineStartNonEmpty: MotionFunction = (text, cursor) => {
  const { line, lineStart } = getCurrentLine(text, cursor);
  const firstNonEmpty = line.search(/\S/);
  return lineStart + (firstNonEmpty >= 0 ? firstNonEmpty : 0);
};

/**
 * 行尾 ($)
 */
export const lineEnd: MotionFunction = (text, cursor) => {
  const { lineEnd } = getCurrentLine(text, cursor);
  return Math.max(0, lineEnd - 1);
};

// ============================================================================
// 文件移动
// ============================================================================

/**
 * 文件首
 */
export const fileStart: MotionFunction = () => {
  return 0;
};

/**
 * 文件尾 (G)
 */
export const fileEnd: MotionFunction = (text) => {
  return Math.max(0, text.length - 1);
};

// ============================================================================
// 字符查找
// ============================================================================

/**
 * 查找字符
 */
export const findChar = (text: string, cursor: number, char: string, count = 1): number => {
  let pos = cursor + 1;
  let found = 0;

  while (pos < text.length && found < count) {
    if (text[pos] === char) {
      found++;
      if (found === count) {
        return pos;
      }
    }
    pos++;
  }

  return cursor; // 未找到，返回原位置
};

/**
 * 反向查找字符 (F)
 */
export const findCharBackward = (text: string, cursor: number, char: string, count = 1): number => {
  let pos = cursor - 1;
  let found = 0;

  while (pos >= 0 && found < count) {
    if (text[pos] === char) {
      found++;
      if (found === count) {
        return pos;
      }
    }
    pos--;
  }

  return cursor; // 未找到，返回原位置
};

/**
 * 查找字符前
 */
export const tillChar = (text: string, cursor: number, char: string, count = 1): number => {
  const found = findChar(text, cursor, char, count);
  return found > cursor ? found - 1 : cursor;
};

/**
 * 反向查找字符前 (T)
 */
export const tillCharBackward = (text: string, cursor: number, char: string, count = 1): number => {
  const found = findCharBackward(text, cursor, char, count);
  return found < cursor ? found + 1 : cursor;
};

// ============================================================================
// 移动映射
// ============================================================================

/**
 * 移动命令映射
 */
export const MOTIONS: Record<string, MotionFunction> = {
  "h": moveLeft,
  "j": moveDown,
  "k": moveUp,
  "l": moveRight,
  "w": nextWord,
  "W": nextWord,
  "b": prevWord,
  "B": prevWord,
  "e": endWord,
  "E": endWord,
  "0": lineStart,
  "^": lineStartNonEmpty,
  "$": lineEnd,
  "gg": fileStart,
  "G": fileEnd,
};

/**
 * 执行移动
 */
export function executeMotion(
  motion: string,
  text: string,
  cursor: number,
  count?: number
): number {
  const motionFn = MOTIONS[motion];

  if (motionFn) {
    return motionFn(text, cursor, count);
  }

  return cursor;
}

// ============================================================================
// 导出
// ============================================================================

export default {
  moveLeft,
  moveRight,
  moveUp,
  moveDown,
  nextWord,
  prevWord,
  endWord,
  lineStart,
  lineStartNonEmpty,
  lineEnd,
  fileStart,
  fileEnd,
  findChar,
  findCharBackward,
  tillChar,
  tillCharBackward,
  executeMotion,
  MOTIONS,
};
