// 可复用合成界面取样；不启动 Host、模型，不含真实文件内容或密钥。
import React from "react";
import { render } from "ink-testing-library";
import { writeFileSync } from "node:fs";
import { App } from "../../src/app.mjs";

const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const captures = {};
for (const [columns, rows] of [[80, 24], [48, 18]]) {
  let notify;
  const client = {
    stderrText: "",
    onNotification(handler) { notify = handler; return () => {}; },
    async request(method) {
      if (method === "initialize") return {};
      if (method === "session/catalog") return { entries: [{ id: "s1", current: true, title: "合成项目预览" }] };
      if (method === "workspace/get") return { directory: "D:/demo" };
      if (method === "usage/status") return { used: 128, budget: 8000 };
      if (method === "model/registry/describe") return { providers: [{ id: "demo", name: "演示供应商", keyConfigured: false }], defaultProviderId: "demo", defaultModel: "demo-model" };
      if (method === "session/projection") return { sessionId: "s1", messageRows: [
        { id: "event-1", eventType: "user/message", text: "解释项目入口与修改建议" },
        { id: "event-2", eventType: "assistant/message", text: "## 项目入口\n使用 **Node.js**。\n> 先审查，再执行。\n```js\nconst 状态 = '待审批'; // 中文不丢\nconsole.log(状态);\n```\n[说明](https://example.test)" },
        { id: "event-4", eventType: "tool/result", text: '{"entry":"index.mjs","status":"read-only"}' },
      ], toolCalls: [{ id: "tool-event-3", eventSeq: 3, callId: "c1", name: "read", arguments: '{"path":"README.md"}', resultMessageId: "event-4", status: "completed" }] };
      throw Error(`unexpected ${method}`);
    },
  };
  const app = render(React.createElement(App, { client, hostPath: "synthetic", version: "preview" }));
  try {
    await wait(120);
    Object.defineProperty(app.stdout, "columns", { value: columns, configurable: true });
    Object.defineProperty(app.stdout, "rows", { value: rows, configurable: true });
    app.stdout.emit("resize"); await wait();
    captures[`${columns}x${rows}-transcript`] = app.lastFrame();
    app.stdin.write("/screen"); await wait(); app.stdin.write("\r"); await wait();
    captures[`${columns}x${rows}-screen`] = app.lastFrame();
    app.stdin.write("/"); await wait();
    captures[`${columns}x${rows}-menu`] = app.lastFrame();
    app.stdin.write("\x03"); await wait();
    notify({ method: "approval/asked", params: { sessionId: "s1", approvalId: 7, tool: "edit",
      argumentsJson: JSON.stringify({ path: "README.md", old_string: "状态：未完成", new_string: "状态：已完成" }) } });
    await wait();
    captures[`${columns}x${rows}-approval`] = app.lastFrame();
  } finally { app.unmount(); app.cleanup(); }
}
// 新鲜全屏实例避免 Ink Static 已打印的历史混入 lastFrame 的 debug 记录。
for (const [columns, rows] of [[80, 24], [48, 18]]) {
  let notify;
  const client = {
    stderrText: "", onNotification(handler) { notify = handler; return () => {}; },
    async request(method) {
      return ({ initialize: {}, "session/catalog": { entries: [{ id: "s1", current: true, title: "合成窄屏审批" }] },
        "workspace/get": { directory: "D:/demo" }, "usage/status": { used: 128, budget: 8000 },
        "model/registry/describe": { providers: [{ id: "demo" }], defaultProviderId: "demo", defaultModel: "demo" },
        "session/projection": { sessionId: "s1", toolCalls: [], messageRows: [{ id: "event-1", eventType: "user/message", text: "核对审批内容" }] },
      })[method] || {};
    },
  };
  const app = render(React.createElement(App, { client, hostPath: "synthetic", mode: "screen", version: "preview" }));
  try {
    await wait(120);
    Object.defineProperty(app.stdout, "columns", { value: columns, configurable: true });
    Object.defineProperty(app.stdout, "rows", { value: rows, configurable: true });
    app.stdout.emit("resize"); await wait();
    notify({ method: "approval/asked", params: { sessionId: "s1", approvalId: 8, tool: "edit",
      argumentsJson: JSON.stringify({ path: "README.md", old_string: "旧内容", new_string: "新内容" }) } });
    await wait();
    captures[`${columns}x${rows}-fresh-approval`] = app.lastFrame();
    if (app.lastFrame().split("\n").length > rows) throw Error(`${columns}x${rows} 审批超出窗口`);
  } finally { app.unmount(); app.cleanup(); }
}
if (!process.argv[2]) throw Error("需要指定 target/tmp 下的取样文件路径");
writeFileSync(process.argv[2], JSON.stringify(captures, null, 2));
console.log(`合成取样 ${Object.keys(captures).length} 帧，无 Host/模型请求`);
