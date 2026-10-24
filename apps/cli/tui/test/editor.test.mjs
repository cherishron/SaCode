import assert from "node:assert/strict";
import test from "node:test";
import { characters, edit, editorState } from "../src/editor.mjs";

test("编辑器：左右插入、前后删除与行首行尾", () => {
  let state = editorState("你好");
  state = edit(state, { type: "left" });
  state = edit(state, { type: "insert", text: "世界" });
  assert.equal(state.text, "你世界好");
  assert.equal(state.cursor, 3);
  state = edit(state, { type: "delete" });
  state = edit(state, { type: "backspace" });
  assert.equal(state.text, "你世");
  assert.equal(edit(state, { type: "start" }).cursor, 0);
  assert.equal(edit(state, { type: "end" }).cursor, 2);
});

test("编辑器：emoji 与组合字符按字素移动和删除", () => {
  const text = "中👨‍👩‍👧‍👦e\u0301";
  assert.equal(characters(text).length, 3);
  const state = edit(edit(editorState(text), { type: "backspace" }), { type: "backspace" });
  assert.equal(state.text, "中");
  assert.equal(state.cursor, 1);
});

test("编辑器：词删除、撤销重做与新编辑丢弃 redo", () => {
  let state = editorState("hello 世界");
  state = edit(state, { type: "word-backspace" });
  assert.equal(state.text, "hello ");
  state = edit(state, { type: "undo" });
  assert.equal(state.text, "hello 世界");
  state = edit(state, { type: "redo" });
  assert.equal(state.text, "hello ");
  state = edit(state, { type: "undo" });
  state = edit(state, { type: "insert", text: "!" });
  assert.equal(edit(state, { type: "redo" }).text, "hello 世界!");
  assert.equal(edit(state, { type: "word-left" }).cursor, 6);
  assert.equal(edit({ ...state, cursor: 0 }, { type: "word-right" }).cursor, 6);
});

test("编辑器：set 不跨提交/清空/字段恢复旧草稿，撤销栈有界", () => {
  let state = edit(editorState(), { type: "insert", text: "不能复活的旧输入" });
  state = edit(state, { type: "set", text: "" });
  assert.equal(edit(state, { type: "undo" }).text, "");
  assert.equal(edit(state, { type: "redo" }).text, "");
  for (let i = 0; i < 80; i++) state = edit(state, { type: "insert", text: "a" });
  assert.equal(state.undo.length, 50);
  assert.equal(edit(editorState(), { type: "delete" }).undo.length, 0);
});

test("编辑器：粘贴只插入不发送，去除 ANSI 与控制字节", () => {
  const state = edit(editorState(), { type: "insert", text: "第一行\r\n第二行\t\x1b[31m红字\x00" });
  assert.equal(state.text, "第一行\n第二行  红字");
  assert.equal(edit(editorState(), { type: "backspace" }).text, "");
});

test("编辑器：多行上下移动及行首行尾保留字素列", () => {
  let state = editorState("你好\n世界\n尾");
  state = edit(state, { type: "up" });
  assert.equal(state.cursor, 4);
  state = edit(state, { type: "start" });
  assert.equal(state.cursor, 3);
  state = edit(state, { type: "end" });
  assert.equal(state.cursor, 5);
  assert.equal(edit(state, { type: "up" }).cursor, 2);
  assert.equal(edit(state, { type: "down" }).cursor, 7);
  assert.equal(edit({ text: "\n尾", cursor: 0 }, { type: "start" }).cursor, 0);
  assert.equal(edit({ text: "\n尾", cursor: 0 }, { type: "down" }).cursor, 1);
});
