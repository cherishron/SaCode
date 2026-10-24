import assert from "node:assert/strict";
import test from "node:test";
import { render } from "ink-testing-library";
import {
  ApprovalBox, Composer, EmptyState, Header, HELP_LINES, StatusBar, ToolActivity, h,
} from "../src/components.mjs";
import { terminalLayout } from "../src/theme.mjs";

test("展示：终端断点不依赖浏览器像素，非法尺寸有回退", () => {
  assert.deepEqual(terminalLayout(100, 30), { width: 100, height: 30, compact: false });
  assert.equal(terminalLayout(48, 24).compact, true);
  assert.equal(terminalLayout(100, 18).compact, true);
  assert.deepEqual(terminalLayout(0, NaN), { width: 80, height: 24, compact: false });
});

test("展示：顶部分离品牌与会话，空态不宣称模型已配置", () => {
  const header = render(h(Header, { version: "test", sessionTitle: "测试会话", cwd: "D:/demo" }));
  try {
    assert.match(header.lastFrame(), /SaCode CLI/);
    assert.match(header.lastFrame(), /测试会话/);
  } finally { header.unmount(); }
  const empty = render(h(EmptyState));
  try {
    assert.match(empty.lastFrame(), /开始使用/);
    assert.match(empty.lastFrame(), /\/auth.*\/model/);
    assert.match(empty.lastFrame(), /有模型配置时才能执行任务/);
  } finally { empty.unmount(); }
});

test("展示：工具活动保留文字状态，未知状态不冒充成功", () => {
  const app = render(h(ToolActivity, { calls: [
    { id: "1", name: "read", arguments: '{"path":"README.md"}', status: "completed" },
    { id: "2", name: "write", arguments: "{}", status: "denied" },
    { id: "3", name: "custom", arguments: "{}", status: "queued" },
  ], width: 80 }));
  try {
    const frame = app.lastFrame();
    assert.match(frame, /工具活动 · 3 项/);
    assert.match(frame, /read.*README.md.*已完成/);
    assert.match(frame, /write.*已拒绝/);
    assert.match(frame, /\?.*custom.*queued/);
  } finally { app.unmount(); }
});

test("展示：审批突出单次范围，输入区提示回答审批而非继续输入", () => {
  const approval = render(h(ApprovalBox, { approval: {
    approvalId: 42, tool: "write", argumentsJson: '{"path":"README.md"}',
  } }));
  try {
    const frame = approval.lastFrame();
    assert.match(frame, /审批 #42 · write/);
    assert.match(frame, /仅针对本次调用/);
    assert.match(frame, /参数摘要：README.md/);
    assert.match(frame, /\[y\].*允许一次[\s\S]*\[n\].*拒绝/);
  } finally { approval.unmount(); }
  const composer = render(h(Composer, { value: "草稿", busy: true, approvalPending: true }));
  try { assert.match(composer.lastFrame(), /请先回答上方审批/); }
  finally { composer.unmount(); }
});

test("展示：状态栏保留真实错误语义，紧凑态省略 token 而非安全提示", () => {
  const app = render(h(StatusBar, { error: "宿主响应超时", usage: { used: 12, budget: 100 }, compact: true }));
  try {
    assert.match(app.lastFrame(), /错误：宿主响应超时/);
    assert.doesNotMatch(app.lastFrame(), /tokens/);
  } finally { app.unmount(); }
  // /clear 已实现为清空对话历史命令，不再是"未实现的错误宣告"。
  assert.ok(HELP_LINES.some((line) => line.includes("/clear")));
});

test("展示：长输入移动到行首时光标仍可见", () => {
  const app = render(h(Composer, { value: "长输入".repeat(100), cursor: 0, busy: false }));
  try { assert.match(app.lastFrame(), /▌/); }
  finally { app.unmount(); }
});
