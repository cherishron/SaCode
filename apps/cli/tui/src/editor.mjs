// 光标以字素计数，删除中文/emoji/组合字符时不截断 UTF-16 代理对。
// 撤销栈保留有限历史，不保存粘贴中的控制字节。
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const characters = (text) => Array.from(segmenter.segment(text), (item) => item.segment);
export const editorState = (text = "") => ({ text, cursor: characters(text).length, undo: [], redo: [] });

function snapshot(state) {
  return { text: state.text, cursor: state.cursor };
}

function pushUndo(state) {
  return [...(state.undo || []), snapshot(state)].slice(-50);
}

export function edit(state, action) {
  const chars = characters(state.text);
  const cursor = Math.max(0, Math.min(state.cursor, chars.length));
  // 提交、清空、历史切换、配置表单换字段都是撤销边界，不跨草稿恢复旧内容。
  if (action.type === "set") return editorState(action.text);
  if (action.type === "replace-reference") return { ...state, text: action.text, cursor: action.cursor, undo: pushUndo(state), redo: [] };
  if (action.type === "left") return { ...state, cursor: Math.max(0, cursor - 1) };
  if (action.type === "right") return { ...state, cursor: Math.min(chars.length, cursor + 1) };
  if (action.type === "start") return { ...state, cursor: cursor === 0 ? 0 : chars.lastIndexOf("\n", cursor - 1) + 1 };
  if (action.type === "end") {
    const end = chars.indexOf("\n", cursor);
    return { ...state, cursor: end < 0 ? chars.length : end };
  }
  if (action.type === "up" || action.type === "down") {
    const lineStart = cursor === 0 ? 0 : chars.lastIndexOf("\n", cursor - 1) + 1;
    const column = cursor - lineStart;
    if (action.type === "up") {
      if (lineStart === 0) return state;
      const previousStart = lineStart < 2 ? 0 : chars.lastIndexOf("\n", lineStart - 2) + 1;
      return { ...state, cursor: Math.min(lineStart - 1, previousStart + column) };
    }
    const end = chars.indexOf("\n", cursor);
    if (end < 0) return state;
    const nextEnd = chars.indexOf("\n", end + 1);
    return { ...state, cursor: Math.min(nextEnd < 0 ? chars.length : nextEnd, end + 1 + column) };
  }
  if (action.type === "kill-left") return { text: chars.slice(cursor).join(""), cursor: 0, undo: pushUndo(state), redo: [] };
  if (action.type === "kill-right") return { text: chars.slice(0, cursor).join(""), cursor, undo: pushUndo(state), redo: [] };
  if (action.type === "word-left" || action.type === "word-right") {
    let pos = cursor;
    if (action.type === "word-left") {
      while (pos > 0 && /\s/.test(chars[pos - 1])) pos--;
      while (pos > 0 && !/\s/.test(chars[pos - 1])) pos--;
    } else {
      while (pos < chars.length && !/\s/.test(chars[pos])) pos++;
      while (pos < chars.length && /\s/.test(chars[pos])) pos++;
    }
    return { ...state, cursor: pos };
  }
  if (action.type === "word-backspace" && cursor > 0) {
    let pos = cursor;
    while (pos > 0 && /\s/.test(chars[pos - 1])) pos--;
    while (pos > 0 && !/\s/.test(chars[pos - 1])) pos--;
    chars.splice(pos, cursor - pos);
    return { text: chars.join(""), cursor: pos, undo: pushUndo(state), redo: [] };
  }
  if (action.type === "backspace" && cursor > 0) {
    chars.splice(cursor - 1, 1);
    return { text: chars.join(""), cursor: cursor - 1, undo: pushUndo(state), redo: [] };
  }
  if (action.type === "delete") {
    if (cursor === chars.length) return state;
    chars.splice(cursor, 1);
    return { text: chars.join(""), cursor, undo: pushUndo(state), redo: [] };
  }
  if (action.type === "insert") {
    // 粘贴保留换行，但绝不模拟提交；清除会影响终端的控制序列。
    const text = action.text.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g, "")
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\r\n?/g, "\n").replace(/\t/g, "  ").replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "");
    const inserted = characters(text);
    if (inserted.length === 0) return state;
    chars.splice(cursor, 0, ...inserted);
    return { text: chars.join(""), cursor: characters(chars.slice(0, cursor + inserted.length).join("")).length, undo: pushUndo(state), redo: [] };
  }
  if (action.type === "undo") {
    if (!state.undo?.length) return state;
    const prev = state.undo[state.undo.length - 1];
    return { text: prev.text, cursor: prev.cursor, undo: state.undo.slice(0, -1), redo: [snapshot(state), ...state.redo].slice(0, 50) };
  }
  if (action.type === "redo") {
    if (!state.redo?.length) return state;
    const next = state.redo[0];
    return { text: next.text, cursor: next.cursor, undo: [...state.undo, snapshot(state)].slice(-50), redo: state.redo.slice(1) };
  }
  return state;
}
