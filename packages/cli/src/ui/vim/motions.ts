/**
 * Vim 移动命令
 */

/**
 * 移动命令映射
 */
export const MOTIONS: Record<string, string> = {
  h: "left",
  l: "right",
  j: "down",
  k: "up",
  w: "word-forward",
  b: "word-backward",
  e: "word-end",
  "0": "line-start",
  $: "line-end",
  G: "file-end",
};

/**
 * 执行移动命令
 */
export function executeMotion(
  motion: string,
  text: string,
  cursor: number,
  count: number = 1
): number {
  const len = text.length;

  switch (motion) {
    case "h":
      return Math.max(0, cursor - count);
    case "l":
      return Math.min(len, cursor + count);
    case "j":
    case "k":
      // 设计决策：单行编辑器中上下移动无意义
      // 如果未来支持多行编辑器，可以实现行间移动
      return cursor;
    case "w": {
      let pos = cursor;
      for (let i = 0; i < count; i++) {
        // 跳到下一个单词
        while (pos < len && /\w/.test(text[pos] ?? "")) pos++;
        while (pos < len && /\s/.test(text[pos] ?? "")) pos++;
      }
      return Math.min(pos, len);
    }
    case "b": {
      let pos = cursor;
      for (let i = 0; i < count; i++) {
        // 跳到上一个单词
        while (pos > 0 && /\s/.test(text[pos - 1] ?? "")) pos--;
        while (pos > 0 && /\w/.test(text[pos - 1] ?? "")) pos--;
      }
      return Math.max(pos, 0);
    }
    case "e": {
      let pos = cursor;
      for (let i = 0; i < count; i++) {
        pos++;
        while (pos < len && /\s/.test(text[pos] ?? "")) pos++;
        while (pos < len && /\w/.test(text[pos] ?? "")) pos++;
      }
      return Math.min(pos, len);
    }
    case "0":
      return 0;
    case "$":
      return len;
    case "G":
    case "gg":
      return motion === "gg" ? 0 : len;
    default:
      return cursor;
  }
}
