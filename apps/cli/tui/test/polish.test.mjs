import assert from "node:assert/strict";
import test from "node:test";
import { render } from "ink-testing-library";
import { Box } from "ink";
import { h, ToolCard, ApprovalBox } from "../src/components.mjs";
import { CodeBlock, highlightLine, Inline, TableBlock } from "../src/content.mjs";
import { Markdown } from "../src/markdown.mjs";
import { approvalPreview, isUnifiedDiff } from "../src/tool-display.mjs";
import { historyMatches } from "../src/history-search.mjs";

function frame(node) {
  const app = render(node);
  try { return app.lastFrame(); }
  finally { app.unmount(); app.cleanup(); }
}

test("高亮：已知/未知/无语言都完整保留中文、emoji、数字后缀", () => {
  const source = 'const 中文变量 = 42n; // 注释🌏';
  for (const lang of [undefined, "", "js", "ts", "python", "bash", "json", "cj", "未知语言"]) {
    assert.equal(highlightLine(source, lang).map((item) => item.text).join(""), source);
  }
  assert.equal(highlightLine("const x = 1", "js")[0].color, "cyan");
  assert.deepEqual(highlightLine("plain text", "unknown"), [{ text: "plain text" }]);
});

test("Markdown：引用、未闭合代码围栏、c++和表格后正文不崩溃或丢失", () => {
  const rendered = frame(h(Markdown, { text: '> 引用\n\n| 项 | 值 |\n|---|---|\n| 中文 | 42 |\n\n# 表后标题\n\n```c++\nauto 名称 = 42;\n末尾', pending: true }));
  for (const text of ["引用", "中文", "42", "表后标题", "c++", "auto 名称 = 42;", "末尾", "正在生成"]) assert.ok(rendered.includes(text), text);
});

test("Markdown：文件名下划线和不完整标记不误删，链接保留目标地址", () => {
  const rendered = frame(h(Inline, { text: 'foo_bar_baz _斜体_ **粗体** *未闭合 [文档](https://example.test/path)' }));
  assert.match(rendered, /foo_bar_baz/);
  assert.match(rendered, /\*未闭合/);
  assert.match(rendered, /文档 \(https:\/\/example.test\/path\)/);
});

test("代码块：未指定语言可渲染，控制码转义，不执行终端命令", () => {
  const rendered = frame(h(CodeBlock, { content: ["中文🌏", "\x1b[2J剩余"] }));
  assert.match(rendered, /中文🌏/);
  assert.match(rendered, /\\u001b\[2J剩余/);
  assert.doesNotMatch(rendered, /\x1b/);
});

test("工具：展开全部结果不丢尾部，普通列表不猜作 diff", () => {
  const call = { name: "read", status: "completed", arguments: "{}", resultText: Array.from({ length: 60 }, (_, i) => `row-${i}`).join("\n") };
  const compact = frame(h(ToolCard, { call }));
  assert.doesNotMatch(compact, /row-59/);
  assert.match(compact, /\/tools/);
  assert.doesNotMatch(compact, /\[e\]/, "历史卡片不能提示没有焦点的快捷键");
  assert.match(frame(h(ToolCard, { call, expanded: true })), /row-59/);
  assert.equal(isUnifiedDiff("清单\n- first\n+ second"), false);
  assert.equal(isUnifiedDiff("--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new"), true);
});

test("审批：只预览请求片段，不能宣称磁盘真实 diff 或伪造写入结果", () => {
  const approval = { tool: "edit", approvalId: 8, argumentsJson: JSON.stringify({ path: "a.txt", old_string: "旧", new_string: "新" }) };
  const preview = approvalPreview(approval);
  assert.match(preview.title, /非磁盘差异/);
  assert.deepEqual(preview.lines, ["- 旧", "+ 新"]);
  assert.match(frame(h(ApprovalBox, { approval })), /拟替换片段/);
  assert.equal(approvalPreview({ tool: "write", argumentsJson: "not-json" }), null);
});

test("窄屏：24列审批仍显示工单、默认拒绝、答票按钮，参数不泄出控制码", () => {
  const rendered = frame(h(Box, { width: 24 }, h(ApprovalBox, { compact: true,
    approval: { approvalId: 9, tool: "write", argumentsJson: '{"path":"a.txt"}' } })));
  assert.match(rendered, /审批 #9/);
  assert.match(rendered, /\[y\]/);
  assert.match(rendered, /\[n\]/);
  assert.match(rendered, /默认/);
});

test("历史搜索：只查当前输入历史，去重且最近优先，大小写不敏感", () => {
  assert.deepEqual(historyMatches(["Old Read", "write", "New READ", "Old Read"], "read"), ["Old Read", "New READ"]);
  assert.deepEqual(historyMatches([], "anything"), []);
});

test("Markdown：轻量 token 着色不会把普通 URL 或井号当别的语言语义", () => {
  assert.ok(!highlightLine("#private = 42", "js")[0].italic);
  assert.equal(highlightLine("# comment", "py")[0].italic, true);
  assert.equal(highlightLine('// comment', "ts")[0].italic, true);
  const text = 'print("https://example.test/#anchor")';
  assert.equal(highlightLine(text, "py").map((part) => part.text).join(""), text);
});

test("表格：短单元格成列，长单元格回退记录，中文内容不丢失", () => {
  const short = frame(h(TableBlock, { headers: ["文件", "状态"], rows: [["main.cj", "完成"]] }));
  assert.match(short, /文件.*│.*状态/);
  assert.match(short, /main.cj.*完成/);
  const long = "中文长单元格".repeat(30);
  const fallback = frame(h(TableBlock, { headers: ["文件"], rows: [[long]] }));
  assert.match(fallback, /文件:/);
  assert.equal(fallback.replace(/\s/g, "").includes(long), true);
});
