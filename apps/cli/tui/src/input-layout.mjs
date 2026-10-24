import stringWidth from "string-width";
import { characters } from "./editor.mjs";

// 光标和折行按终端字格，不按 JS 字符串长度；不改变用户的原始草稿。
export function inputLines(text, cursor, width) {
  const chars = characters(text);
  const columns = Math.max(2, Math.floor(width));
  const lines = [{ text: "", start: 0, cells: 0 }];
  let cursorRow = 0;
  let cursorCells = 0;
  for (let index = 0; index <= chars.length; index++) {
    let line = lines.at(-1);
    const char = chars[index];
    const cells = char === undefined || char === "\n" ? 0 : stringWidth(char);
    if (char !== "\n" && line.cells + (cells || 1) > columns) {
      lines.push({ text: "", start: index, cells: 0 });
      line = lines.at(-1);
    }
    if (index === cursor) { cursorRow = lines.length - 1; cursorCells = line.cells; }
    if (char === undefined) break;
    if (char === "\n") { lines.push({ text: "", start: index + 1, cells: 0 }); continue; }
    line.text += char;
    line.cells += cells;
  }
  return { lines, cursorRow, cursorCells };
}
